import { describe, it, expect, afterEach } from "bun:test";
import { createConnection } from "node:net";
import { probes } from "../src/lib";
import type { ProbesInstance } from "../src/interfaces/types";

let instances: ProbesInstance[] = [];

afterEach(async () => {
  for (const p of instances) {
    await p.close();
  }
  instances = [];
});

function track<T extends ProbesInstance>(p: T): T {
  instances.push(p);
  return p;
}

describe("probes() factory", () => {
  it("creates instance with sql only", async () => {
    const p = track(
      await probes({
        sql: { path: "./__tmp_lib_test__/test.db" },
      })
    );

    await p.sql.put({
      table: "items",
      rows: [{ id: 1, name: "widget" }],
      force_schema: true,
    });
    const rows = await p.sql.read({ table: "items" });
    expect(rows).toHaveLength(1);
  });

  it("creates instance with http client only", async () => {
    const server = Bun.serve({
      port: 29876,
      fetch: () => new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      }),
    });

    try {
      const p = track(
        await probes({
          http: { client: { base_url: "http://localhost:29876" } },
        })
      );

      const res = await p.http.send({ method: "GET", path: "/" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    } finally {
      server.stop();
    }
  });

  it("creates instance with fs only", async () => {
    const p = track(
      await probes({
        fs: { root: "./__tmp_lib_test__/fs-root" },
      })
    );

    await p.fs.put({ path: "test.txt", content: "hello" });
    const content = await p.fs.read({ path: "test.txt" });
    expect(content).toBe("hello");
  });

  it("configure merges new config", async () => {
    const p = track(
      await probes({
        sql: { path: "./__tmp_lib_test__/before.db" },
      })
    );

    const updated = await p.configure({
      sql: { path: "./__tmp_lib_test__/after.db" },
    });

    expect(updated.interfaces?.sql?.path).toBe("./__tmp_lib_test__/after.db");
  });

  it("creates instance with empty config", async () => {
    const p = track(await probes({}));
    expect(p.proof).toBeDefined();
  });

  it("creates instance with tcp only", async () => {
    const p = track(
      await probes({
        tcp: [{ name: "test_tcp", port: 29877 }],
      })
    );

    const watchIter = p.tcp.watch({ target: "test_tcp", timeout_ms: 3000 });
    const watchPromise = watchIter[Symbol.asyncIterator]().next();

    await new Promise<void>((resolve) => {
      const client = createConnection({ port: 29877, host: "127.0.0.1" }, () => {
        client.write(Buffer.from("lib test"));
        setTimeout(() => client.destroy(), 200);
        resolve();
      });
    });

    const result = await watchPromise;
    expect(Buffer.from(result.value.data, "base64").toString()).toBe("lib test");
  });
});
