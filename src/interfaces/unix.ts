import type { UnixClientConfig, UnixServerConfig, UnixServerTargetConfig, CapturedUnixData } from "./types";
import type { RecordBuffer } from "./record";
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

export interface UnixActions<In = string, Out = string> {
  send: (params: { data: In; path?: string; timeout_ms?: number }) => Promise<Out>;
  send_json: (params: { data: unknown; path?: string; timeout_ms?: number }) => Promise<unknown>;
  watch: (params: { target: string; timeout_ms?: number }) => AsyncIterable<CapturedUnixData>;
  close: () => void;
}

export function createUnixInterface(config: {
  client?: UnixClientConfig;
  server?: UnixServerConfig;
}, record?: RecordBuffer): UnixActions & { use: <In, Out>(factory: (raw: UnixActions) => Partial<UnixActions<In, Out>>) => UnixActions<In, Out> } {
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

      record?.push({
        kind: "send",
        time: new Date().toISOString(),
        interface: "unix",
        action: "send",
        path: targetPath,
        data,
      });

      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          record?.push({
            kind: "response",
            time: new Date().toISOString(),
            interface: "unix",
            raw: "timeout",
          });
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
                const raw = Buffer.concat(chunks).toString();
                record?.push({
                  kind: "response",
                  time: new Date().toISOString(),
                  interface: "unix",
                  raw,
                });
                resolve(raw);
              },
              error(_socket, err) {
                clearTimeout(timer);
                record?.push({
                  kind: "response",
                  time: new Date().toISOString(),
                  interface: "unix",
                  raw: `error: ${err.message}`,
                });
                reject(new Error(`Unix socket error: ${err.message}`));
              },
            },
          });
        } catch (err: any) {
          clearTimeout(timer);
          record?.push({
            kind: "response",
            time: new Date().toISOString(),
            interface: "unix",
            raw: `connect error: ${err.message}`,
          });
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

    use<In, Out>(factory: (raw: UnixActions) => Partial<UnixActions<In, Out>>): UnixActions<In, Out> {
      const self = this;
      const adapted = factory(self);
      return {
        send: adapted.send
          ? (p) => adapted.send!(p)
          : (p) => self.send(p as any) as any,
        send_json: adapted.send_json
          ? (p) => adapted.send_json!(p)
          : (p) => self.send_json(p),
        watch: adapted.watch
          ? (p) => adapted.watch!(p)
          : (p) => self.watch(p),
        close: adapted.close
          ? () => adapted.close!()
          : () => self.close(),
      };
    },
  };
}
