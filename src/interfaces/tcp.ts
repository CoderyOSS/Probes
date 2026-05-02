import { createServer, type Socket } from "node:net";
import type { TcpTargetConfig, CapturedTcpData } from "./types";

export interface TcpActions {
  send: (params: { target: string; data: string }) => Promise<void>;
  watch: (params: {
    target: string;
    timeout_ms?: number;
  }) => AsyncIterable<CapturedTcpData>;
  close: () => void;
}

interface TargetState {
  name: string;
  server: ReturnType<typeof createServer>;
  sockets: Set<Socket>;
  pendingResolve: ((value: CapturedTcpData) => void) | null;
  pendingReject: ((reason: Error) => void) | null;
  buffered: CapturedTcpData | null;
}

export function createTcpInterface(targets: TcpTargetConfig[]): TcpActions {
  const targetMap = new Map<string, TargetState>();

  for (const targetConfig of targets) {
    const server = createServer();
    const state: TargetState = {
      name: targetConfig.name,
      server,
      sockets: new Set(),
      pendingResolve: null,
      pendingReject: null,
      buffered: null,
    };

    server.on("connection", (socket: Socket) => {
      state.sockets.add(socket);

      socket.on("data", (raw: Buffer) => {
        const captured: CapturedTcpData = {
          data: raw.toString("base64"),
          timestamp: Date.now(),
          remote: `${socket.remoteAddress}:${socket.remotePort}`,
        };

        if (state.pendingResolve) {
          state.pendingResolve(captured);
          state.pendingResolve = null;
          state.pendingReject = null;
        } else {
          state.buffered = captured;
        }
      });

      socket.on("close", () => {
        state.sockets.delete(socket);
      });

      if (targetConfig.idle_timeout_ms) {
        socket.setTimeout(targetConfig.idle_timeout_ms);
        socket.on("timeout", () => {
          socket.destroy();
        });
      }
    });

    server.listen(targetConfig.port, "127.0.0.1");
    targetMap.set(targetConfig.name, state);
  }

  return {
    async send({ target, data }) {
      const state = targetMap.get(target);
      if (!state) throw new Error(`TCP target not found: ${target}`);
      const buf = Buffer.from(data, "base64");
      for (const socket of state.sockets) {
        socket.write(buf);
      }
    },

    watch({
      target,
      timeout_ms = 30000,
    }): AsyncIterable<CapturedTcpData> {
      const state = targetMap.get(target);
      if (!state) throw new Error(`TCP target not found: ${target}`);

      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (state.buffered) {
                const captured = state.buffered;
                state.buffered = null;
                return { value: captured, done: false };
              }

              return new Promise<{ value: CapturedTcpData; done: false }>(
                (resolve, reject) => {
                  const timer = setTimeout(() => {
                    state.pendingResolve = null;
                    state.pendingReject = null;
                    reject(
                      new Error(
                        `Watch timeout: no data received within ${timeout_ms}ms`
                      )
                    );
                  }, timeout_ms);

                  state.pendingReject = (err: Error) => {
                    clearTimeout(timer);
                    reject(err);
                  };

                  state.pendingResolve = (captured: CapturedTcpData) => {
                    clearTimeout(timer);
                    resolve({ value: captured, done: false });
                  };
                }
              );
            },
            async return() {
              if (state.pendingReject) {
                state.pendingReject(new Error("Watch cancelled"));
                state.pendingResolve = null;
                state.pendingReject = null;
              }
              return { value: undefined, done: true as const };
            },
          };
        },
      };
    },

    close() {
      for (const state of targetMap.values()) {
        for (const socket of state.sockets) {
          socket.destroy();
        }
        if (state.pendingReject) {
          state.pendingReject(new Error("TCP interface closed"));
        }
        state.pendingResolve = null;
        state.pendingReject = null;
        state.server.close();
      }
      targetMap.clear();
    },
  };
}
