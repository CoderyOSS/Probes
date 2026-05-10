import type { WsServerTargetConfig, CapturedWsMessage } from "./types";
import type { RecordBuffer } from "./record";

export interface WsServerActions {
  send: (params: { target: string; data: string; binary?: boolean }) => Promise<void>;
  watch: (params: {
    target: string;
    timeout_ms?: number;
  }) => AsyncIterable<CapturedWsMessage>;
  reset: (params: { target: string }) => Promise<void>;
  close: () => void;
}

interface TargetState {
  name: string;
  server: ReturnType<typeof Bun.serve>;
  sockets: Set<any>;
  pendingResolve: ((value: CapturedWsMessage) => void) | null;
  pendingReject: ((reason: Error) => void) | null;
  buffered: CapturedWsMessage | null;
}

export function createWsServerInterface(targets: WsServerTargetConfig[], _record?: RecordBuffer): WsServerActions {
  const targetMap = new Map<string, TargetState>();

  for (const targetConfig of targets) {
    const state: TargetState = {
      name: targetConfig.name,
      server: null as any,
      sockets: new Set(),
      pendingResolve: null,
      pendingReject: null,
      buffered: null,
    };

    const server = Bun.serve({
      port: targetConfig.port,
      fetch(req, server) {
        const success = server.upgrade(req);
        if (!success) {
          return new Response("Upgrade Required", { status: 426 });
        }
        return undefined as any;
      },
      websocket: {
        open(ws: any) {
          state.sockets.add(ws);
          if (targetConfig.idle_timeout_ms) {
            (ws as any).timeout(targetConfig.idle_timeout_ms / 1000);
          }
        },
        message(ws: any, message: string | ArrayBuffer) {
          const isBinary = typeof message !== "string";
          const captured: CapturedWsMessage = {
            data: isBinary ? "" : (message as string),
            ...(isBinary ? { data_base64: Buffer.from(message as unknown as ArrayBuffer).toString("base64") } : {}),
            timestamp: Date.now(),
            remote: (ws as any).remoteAddress as string,
            type: isBinary ? "binary" : "text",
          };

          if (state.pendingResolve) {
            state.pendingResolve(captured);
            state.pendingResolve = null;
            state.pendingReject = null;
          } else {
            state.buffered = captured;
          }
        },
        close(ws: any) {
          state.sockets.delete(ws);
        },
      } as any,
    });

    state.server = server;
    targetMap.set(targetConfig.name, state);
  }

  return {
    async send({ target, data, binary }) {
      const state = targetMap.get(target);
      if (!state) throw new Error(`WS target not found: ${target}`);
      if (state.sockets.size === 0) return;

      for (const ws of state.sockets) {
        if (binary) {
          const buf = Buffer.from(data, "base64");
          ws.send(buf);
        } else {
          ws.send(data);
        }
      }
    },

    watch({
      target,
      timeout_ms = 30000,
    }): AsyncIterable<CapturedWsMessage> {
      const state = targetMap.get(target);
      if (!state) throw new Error(`WS target not found: ${target}`);

      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (state.buffered) {
                const captured = state.buffered;
                state.buffered = null;
                return { value: captured, done: false };
              }

              return new Promise<{ value: CapturedWsMessage; done: false }>(
                (resolve, reject) => {
                  const timer = setTimeout(() => {
                    state.pendingResolve = null;
                    state.pendingReject = null;
                    reject(
                      new Error(
                        `Watch timeout: no message received within ${timeout_ms}ms`
                      )
                    );
                  }, timeout_ms);

                  state.pendingReject = (err: Error) => {
                    clearTimeout(timer);
                    reject(err);
                  };

                  state.pendingResolve = (captured: CapturedWsMessage) => {
                    clearTimeout(timer);
                    resolve({ value: captured, done: false });
                  };
                }
              );
            },
            async return() {
              if (state.pendingReject) {
                state.pendingReject(new Error("Watch cancelled"));
              }
              state.pendingResolve = null;
              state.pendingReject = null;
              return { value: undefined, done: true as const };
            },
          };
        },
      };
    },

    async reset({ target }) {
      const state = targetMap.get(target);
      if (!state) throw new Error(`WS target not found: ${target}`);
      state.buffered = null;
    },

    close() {
      for (const state of targetMap.values()) {
        for (const ws of state.sockets) {
          ws.close();
        }
        if (state.pendingReject) {
          state.pendingReject(new Error("WS interface closed"));
        }
        state.pendingResolve = null;
        state.pendingReject = null;
        state.server.stop();
      }
      targetMap.clear();
    },
  };
}
