import type { HttpConfig, HttpResponse, CapturedRequest } from "./types";
import type { RecordBuffer } from "./record";
import { RequestBuffer } from "../utils/state";

export interface HttpActions {
  send: (params: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  }) => Promise<HttpResponse>;
  put: (params: {
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
  }) => Promise<void>;
  read: () => Promise<CapturedRequest[]>;
  watch: (params?: { timeout_ms?: number }) => Promise<CapturedRequest>;
  reset: () => Promise<void>;
  close: () => void;
}

export function createHttpInterface(config: HttpConfig, record?: RecordBuffer): HttpActions {
  const buffer = new RequestBuffer();
  let stagedResponse: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
  } | null = null;
  let pendingWatch: ((req: CapturedRequest) => void) | null = null;
  let serverInstance: ReturnType<typeof Bun.serve> | null = null;

  if (config.server) {
    serverInstance = Bun.serve({
      port: config.server.port,
      async fetch(req) {
        const body =
          req.method !== "GET" && req.method !== "HEAD"
            ? await req.text()
            : null;

        const captured: CapturedRequest = {
          method: req.method,
          path: new URL(req.url).pathname,
          headers: Object.fromEntries(req.headers.entries()),
          body,
          timestamp: Date.now(),
        };

        buffer.push(captured);

        record?.push({
          kind: "recv",
          time: new Date().toISOString(),
          source: "http:request",
          data: [{
            method: captured.method,
            path: captured.path,
            headers: captured.headers,
            body: captured.body,
          }],
        });

        if (pendingWatch) {
          pendingWatch(captured);
          pendingWatch = null;
        }

        if (stagedResponse) {
          const headers = new Headers();
          if (stagedResponse.headers) {
            for (const [k, v] of Object.entries(stagedResponse.headers)) {
              headers.set(k, v);
            }
          }
          const bodyStr =
            typeof stagedResponse.body === "string"
              ? stagedResponse.body
              : JSON.stringify(stagedResponse.body);
          if (
            !headers.has("content-type") &&
            typeof stagedResponse.body === "object"
          ) {
            headers.set("content-type", "application/json");
          }
          return new Response(bodyStr, {
            status: stagedResponse.status,
            headers,
          });
        }

        return new Response("No response staged", { status: 503 });
      },
    });
  }

  return {
    async send({ method, path, headers: extraHeaders, body }) {
      if (!config.client) {
        throw new Error("HTTP client not configured");
      }

      const url = `${config.client.base_url}${path}`;
      const reqHeaders: Record<string, string> = {
        ...config.client.headers,
        ...extraHeaders,
      };

      const res = await fetch(url, {
        method,
        headers: reqHeaders,
        body: body ? JSON.stringify(body) : undefined,
      });

      const contentType = res.headers.get("content-type") ?? "";
      let responseBody: unknown;
      if (contentType.includes("application/json")) {
        responseBody = await res.json();
      } else {
        responseBody = await res.text();
      }

      return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: responseBody,
      };
    },

    async put({ status, headers, body }) {
      stagedResponse = {
        status,
        headers: headers ?? {},
        body: body ?? null,
      };
      record?.push({
        kind: "send",
        time: new Date().toISOString(),
        interface: "http",
        action: "put",
        data: typeof body === "string" ? body : JSON.stringify(body ?? null),
      });
    },

    async read() {
      return buffer.drain();
    },

    async watch(params) {
      const timeout_ms = params?.timeout_ms ?? 30000;

      const existing = buffer.drain();
      if (existing.length > 0) return existing[0];

      return new Promise<CapturedRequest>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingWatch = null;
          reject(
            new Error(
              `Watch timeout: no request received within ${timeout_ms}ms`
            )
          );
        }, timeout_ms);

        pendingWatch = (req) => {
          clearTimeout(timer);
          resolve(req);
        };
      });
    },

    async reset() {
      buffer.clear();
      stagedResponse = null;
    },

    close() {
      if (serverInstance) {
        serverInstance.stop();
        serverInstance = null;
      }
    },

    use<In, Out>(adapter: Partial<HttpActions>): HttpActions {
      const self = this;
      return {
        send: adapter.send
          ? (p) => adapter.send!(p)
          : (p) => self.send(p),
        put: adapter.put
          ? (p) => adapter.put!(p)
          : (p) => self.put(p),
        read: adapter.read
          ? () => adapter.read!()
          : () => self.read(),
        watch: adapter.watch
          ? (p) => adapter.watch!(p)
          : (p) => self.watch(p),
        reset: adapter.reset
          ? () => adapter.reset!()
          : () => self.reset(),
        close: adapter.close
          ? () => adapter.close!()
          : () => self.close(),
      };
    },
  };
}
