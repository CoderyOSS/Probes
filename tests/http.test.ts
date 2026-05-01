import { describe, it, expect } from "bun:test";
import { createHttpInterface } from "../src/interfaces/http";
import type { HttpConfig } from "../src/interfaces/types";

let http: ReturnType<typeof createHttpInterface>;

describe("http client mode", () => {
  it("sends GET request and returns response", async () => {
    const server = Bun.serve({
      port: 19876,
      fetch(req) {
        return new Response(JSON.stringify({ hello: "world" }), {
          headers: { "content-type": "application/json" },
        });
      },
    });

    try {
      http = createHttpInterface({
        client: { base_url: "http://localhost:19876" },
      });

      const res = await http.send({ method: "GET", path: "/test" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hello: "world" });
    } finally {
      server.stop();
      http.close();
    }
  });

  it("sends POST request with body", async () => {
    let receivedBody: unknown = null;
    const server = Bun.serve({
      port: 19877,
      async fetch(req) {
        receivedBody = await req.json();
        return new Response(null, { status: 201 });
      },
    });

    try {
      http = createHttpInterface({
        client: { base_url: "http://localhost:19877" },
      });

      const res = await http.send({
        method: "POST",
        path: "/users",
        body: { name: "Alice" },
      });
      expect(res.status).toBe(201);
      expect(receivedBody).toEqual({ name: "Alice" });
    } finally {
      server.stop();
      http.close();
    }
  });

  it("sends with custom headers", async () => {
    let receivedAuth: string | null = null;
    const server = Bun.serve({
      port: 19878,
      fetch(req) {
        receivedAuth = req.headers.get("authorization");
        return new Response("ok");
      },
    });

    try {
      http = createHttpInterface({
        client: {
          base_url: "http://localhost:19878",
          headers: { Authorization: "Bearer test-token" },
        },
      });

      await http.send({ method: "GET", path: "/secure" });
      expect(receivedAuth).toBe("Bearer test-token");
    } finally {
      server.stop();
      http.close();
    }
  });
});

describe("http server mode", () => {
  it("captures incoming requests via read", async () => {
    http = createHttpInterface({
      server: { port: 19879 },
    });

    try {
      await http.put({ status: 200, body: "ok" });

      await fetch("http://localhost:19879/test-path", {
        method: "POST",
        headers: { "x-custom": "value" },
        body: "request body",
      });

      const captured = await http.read();
      expect(captured).toHaveLength(1);
      expect(captured[0].method).toBe("POST");
      expect(captured[0].path).toBe("/test-path");
      expect(captured[0].headers["x-custom"]).toBe("value");
    } finally {
      http.close();
    }
  });

  it("returns staged response via put", async () => {
    http = createHttpInterface({
      server: { port: 19880 },
    });

    try {
      await http.put({
        status: 418,
        headers: { "x-teapot": "yes" },
        body: { message: "I'm a teapot" },
      });

      const res = await fetch("http://localhost:19880/anything");
      expect(res.status).toBe(418);
      expect(res.headers.get("x-teapot")).toBe("yes");
      const body = await res.json();
      expect(body).toEqual({ message: "I'm a teapot" });
    } finally {
      http.close();
    }
  });

  it("returns 503 when no response staged", async () => {
    http = createHttpInterface({
      server: { port: 19881 },
    });

    try {
      const res = await fetch("http://localhost:19881/nope");
      expect(res.status).toBe(503);
    } finally {
      http.close();
    }
  });

  it("watch waits for incoming request", async () => {
    http = createHttpInterface({
      server: { port: 19882 },
    });

    try {
      await http.put({ status: 200, body: "ok" });

      const watchPromise = http.watch({ timeout_ms: 3000 });

      await new Promise((r) => setTimeout(r, 50));
      await fetch("http://localhost:19882/watched");

      const captured = await watchPromise;
      expect(captured.path).toBe("/watched");
    } finally {
      http.close();
    }
  });

  it("reset clears captured requests", async () => {
    http = createHttpInterface({
      server: { port: 19883 },
    });

    try {
      await http.put({ status: 200, body: "ok" });
      await fetch("http://localhost:19883/first");
      await http.reset();

      const captured = await http.read();
      expect(captured).toHaveLength(0);
    } finally {
      http.close();
    }
  });
});
