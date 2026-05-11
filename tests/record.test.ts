import { describe, it, expect, beforeAll, afterEach } from "bun:test";
import { probes } from "../src/lib";
import type { ProbesInstance } from "../src/interfaces/types";
import { existsSync, readFileSync, unlinkSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TMP = join(import.meta.dir, "__tmp_record_test__");

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

describe("probes.proof", () => {
  it("save() writes proof records with auto-captured events", async () => {
    const output = join(TMP, "proof.md");
    const p = await probes({
      interfaces: { sql: { path: join(TMP, "test.db") } },
      proof: { output },
    });

    await p.sql.put({ table: "items", rows: [{ id: 1, name: "widget" }] });
    await p.sql.read({ table: "items" });
    p.proof.save();
    await p.close();

    expect(existsSync(output)).toBe(true);
    const content = readFileSync(output, "utf8");
    expect(content).toContain("sql:items");
    expect(content).toContain("E2E Proof Records");
  });

  it("throws if accessed without proof configured", async () => {
    const p = await probes({
      proof: { output: join(TMP, "proof.md") },
    });
    p.proof.save();
    await p.close();
  });

  it("writes title if configured", async () => {
    const output = join(TMP, "titled.md");
    const p = await probes({
      proof: { output, title: "Custom Title" },
    });

    p.proof.save();
    await p.close();

    const content = readFileSync(output, "utf8");
    expect(content).toContain("Custom Title");
  });

  it("captures unix send/response events", async () => {
    const output = join(TMP, "unix-proof.md");
    const p = await probes({
      interfaces: {
        unix: {
          server: [{ name: "test", path: join(TMP, "srv.sock") }],
        },
        sql: { path: join(TMP, "ux.db") },
      },
      proof: { output },
    });

    await p.sql.put({ table: "t", rows: [{ x: 1 }] });
    await p.sql.read({ table: "t" });
    p.proof.save();
    await p.close();

    const content = readFileSync(output, "utf8");
    expect(content).toContain("sql:t");
  });

  it("multiple events captured in chronological order", async () => {
    const output = join(TMP, "chrono.md");
    const p = await probes({
      interfaces: { sql: { path: join(TMP, "chrono.db") } },
      proof: { output },
    });

    await p.sql.put({ table: "first", rows: [{ v: 1 }] });
    await p.sql.put({ table: "second", rows: [{ v: 2 }] });
    p.proof.save();
    await p.close();

    expect(existsSync(output)).toBe(true);
  });
});
