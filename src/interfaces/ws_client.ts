import type { WsClientTargetConfig, CapturedWsMessage } from "./types";
import type { RecordBuffer } from "./record";

export interface WsClientActions {
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
  url: string;
  ws: WebSocket | null;
  connected: boolean;
  pendingResolve: ((value: CapturedWsMessage) => void) | null;
  pendingReject: ((reason: Error) => void) | null;
  buffered: CapturedWsMessage | null;
}

export async function createWsClientInterface(targets: WsClientTargetConfig[], _record?: RecordBuffer): Promise<WsClientActions> {
  const targetMap = new Map<string, TargetState>();

  await Promise.all(
    targets.map(
      (targetConfig) =>
        new Promise<void>((resolve, reject) => {
          const state: TargetState = {
            name: targetConfig.name,
            url: targetConfig.url,
            ws: null,
            connected: false,
            pendingResolve: null,
            pendingReject: null,
            buffered: null,
          };

          const ws = new WebSocket(targetConfig.url);

          ws.addEventListener("open", () => {
            state.connected = true;
            resolve();
          });

          ws.addEventListener("message", (event: MessageEvent) => {
            const message = event.data;
            const isBinary = typeof message !== "string";
            const captured: CapturedWsMessage = {
              data: isBinary ? "" : (message as string),
              ...(isBinary ? { data_base64: Buffer.from(message as unknown as ArrayBuffer).toString("base64") } : {}),
              timestamp: Date.now(),
              remote: targetConfig.url,
              type: isBinary ? "binary" : "text",
            };

            if (state.pendingResolve) {
              state.pendingResolve(captured);
              state.pendingResolve = null;
              state.pendingReject = null;
            } else {
              state.buffered = captured;
            }
          });

          ws.addEventListener("close", () => {
            state.connected = false;
          });

          ws.addEventListener("error", () => {
            state.connected = false;
            if (!state.ws) {
              reject(new Error(`WS client connection failed: ${targetConfig.url}`));
            }
          });

          state.ws = ws;
          targetMap.set(targetConfig.name, state);
        })
    )
  );

  return {
    async send({ target, data, binary }) {
      const state = targetMap.get(target);
      if (!state) throw new Error(`WS target not found: ${target}`);
      if (!state.connected || !state.ws) throw new Error(`WS target not connected: ${target}`);

      if (binary) {
        const buf = Buffer.from(data, "base64");
        state.ws.send(buf);
      } else {
        state.ws.send(data);
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
        if (state.ws) {
          state.ws.close();
        }
        if (state.pendingReject) {
          state.pendingReject(new Error("WS interface closed"));
        }
        state.pendingResolve = null;
        state.pendingReject = null;
      }
      targetMap.clear();
    },
  };
}
