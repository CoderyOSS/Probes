import type { UnixClientConfig, UnixServerConfig, UnixServerTargetConfig, CapturedUnixData } from "./types";
import type { Socket, TCPSocketListener } from "bun";

interface TargetState {
  name: string;
  path: string;
  listener: TCPSocketListener<unknown>;
  sockets: Set<Socket<unknown>>;
  buffered: CapturedUnixData | null;
  pendingResolve: ((value: CapturedUnixData) => void) | null;
  pendingReject: ((reason: Error) => void) | null;
}

export interface UnixActions {
  send: (params: { data: string; path?: string; timeout_ms?: number }) => Promise<string>;
  send_json: (params: { data: unknown; path?: string; timeout_ms?: number }) => Promise<unknown>;
  watch: (params: { target: string; timeout_ms?: number }) => AsyncIterable<CapturedUnixData>;
  close: () => void;
}

export function createUnixInterface(config: {
  client?: UnixClientConfig;
  server?: UnixServerConfig;
}): UnixActions {
  const targetMap = new Map<string, TargetState>();

  if (config.server) {
    for (const targetConfig of config.server) {
      const { path } = targetConfig;

      try {
        const stat = require("node:fs").statSync(path);
        if (stat.isSocket()) {
          require("node:fs").unlinkSync(path);
        }
      } catch {
        // path doesn't exist, fine
      }

      const listener = Bun.listen({
        unix: path,
        socket: {
          open(socket) {
            state.sockets.add(socket);
          },
          data(socket, data) {
            const captured: CapturedUnixData = {
              data: Buffer.from(data).toString("base64"),
              timestamp: Date.now(),
              peer_path: undefined,
            };

            if (state.pendingResolve) {
              state.pendingResolve(captured);
              state.pendingResolve = null;
              state.pendingReject = null;
            } else {
              state.buffered = captured;
            }
          },
          close(socket) {
            state.sockets.delete(socket);
          },
        },
      });

      const state: TargetState = {
        name: targetConfig.name,
        path,
        listener,
        sockets: new Set(),
        buffered: null,
        pendingResolve: null,
        pendingReject: null,
      };

      targetMap.set(targetConfig.name, state);
    }
  }

  return {
    async send({ data, path, timeout_ms = 30000 }) {
      const targetPath = path ?? config.client?.path;
      if (!targetPath) {
        throw new Error("Unix path not provided and no client path configured");
      }

      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Unix send timeout: no response within ${timeout_ms}ms`));
        }, timeout_ms);

        const chunks: Buffer[] = [];

        try {
          Bun.connect({
            unix: targetPath,
            socket: {
              open(socket) {
                socket.write(Buffer.from(data));
              },
              data(_socket, incoming) {
                chunks.push(Buffer.from(incoming));
              },
              close(_socket) {
                clearTimeout(timer);
                resolve(Buffer.concat(chunks).toString());
              },
              error(_socket, err) {
                clearTimeout(timer);
                reject(new Error(`Unix socket error: ${err.message}`));
              },
            },
          });
        } catch (err: any) {
          clearTimeout(timer);
          reject(new Error(`Unix connect failed: ${err.message}`));
        }
      });
    },

    async send_json({ data, path, timeout_ms = 30000 }) {
      const raw = await this.send({
        data: JSON.stringify(data) + "\n",
        path,
        timeout_ms,
      });
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },

    watch({
      target,
      timeout_ms = 30000,
    }): AsyncIterable<CapturedUnixData> {
      const state = targetMap.get(target);
      if (!state) throw new Error(`Unix target not found: ${target}`);

      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (state.buffered) {
                const captured = state.buffered;
                state.buffered = null;
                return { value: captured, done: false };
              }

              return new Promise<{ value: CapturedUnixData; done: false }>(
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

                  state.pendingResolve = (captured: CapturedUnixData) => {
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
          socket.end();
        }
        if (state.pendingReject) {
          state.pendingReject(new Error("Unix interface closed"));
        }
        state.pendingResolve = null;
        state.pendingReject = null;
        state.listener.stop();
        try {
          require("node:fs").unlinkSync(state.path);
        } catch {}
      }
      targetMap.clear();
    },
  };
}
