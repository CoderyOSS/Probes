import { describe, it, expect } from "bun:test";
import { group } from "../src/lib";
import type { ProbesGroup, ProbesInstance } from "../src/interfaces/types";

const BASE_CONFIG = {
  sql: { path: "./__tmp_lib_test__/group-test.db" },
} as const;

describe("probes.group()", () => {
  it("attach() returns ProbesInstance", async () => {
    const g = group(BASE_CONFIG);
    const p = await g.attach();
    expect(p.sql).toBeDefined();
    await p.sql.put({ table: "t", rows: [{ x: 1 }] });
    await g.detach();
  });

  it("two attach() calls return same instance", async () => {
    const g = group(BASE_CONFIG);
    const p1 = await g.attach();
    const p2 = await g.attach();
    expect(p1).toBe(p2);
    await g.detach();
    await g.detach();
  });

  it("detach() does not close when consumers remain", async () => {
    const g = group(BASE_CONFIG);
    const p1 = await g.attach();
    const p2 = await g.attach();
    await g.detach();
    await p2.sql.put({ table: "t2", rows: [{ y: 2 }] });
    const rows = await p2.sql.read({ table: "t2" });
    expect(rows).toHaveLength(1);
    await g.detach();
  });

  it("last detach() closes instance", async () => {
    const g = group(BASE_CONFIG);
    const p = await g.attach();
    await g.detach();
    let err: Error | null = null;
    try {
      await p.sql.put({ table: "t", rows: [{ x: 1 }] });
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
  });

  it("attach() after full detach creates fresh instance", async () => {
    const g = group(BASE_CONFIG);
    const p1 = await g.attach();
    await g.detach();
    const p2 = await g.attach();
    expect(p1).not.toBe(p2);
    await g.detach();
  });

  it("onTeardown hooks called before close, in order", async () => {
    const g = group(BASE_CONFIG);
    const calls: string[] = [];
    g.onTeardown(async () => { calls.push("hook1"); });
    g.onTeardown(async () => { calls.push("hook2"); });
    const p = await g.attach();
    await g.detach();
    expect(calls).toEqual(["hook1", "hook2"]);
  });

  it("teardown hooks cleared after run — fresh attach doesn't re-run them", async () => {
    const g = group(BASE_CONFIG);
    const calls: string[] = [];
    g.onTeardown(async () => { calls.push("only-once"); });
    const p1 = await g.attach();
    await p1.sql.put({ table: "session1", rows: [{ v: 1 }] });
    await g.detach();
    expect(calls).toEqual(["only-once"]);

    const p2 = await g.attach();
    await p2.sql.put({ table: "session2", rows: [{ v: 2 }] });
    const rows = await p2.sql.read({ table: "session2" });
    expect(rows).toHaveLength(1);
    await g.detach();
    expect(calls).toEqual(["only-once"]);
  });

  it("config validates on attach — rejects bad config", async () => {
    const g = group({} as any);
    try {
      await g.attach();
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("interface");
    }
  });

  it("close() is idempotent — second close doesn't throw", async () => {
    const g = group(BASE_CONFIG);
    const p = await g.attach();
    await g.detach();
    await g.detach();
  });
});
