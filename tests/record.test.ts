import { describe, it, expect, afterEach, afterAll } from "bun:test";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { probes } from "../src/lib";

const OUTPUT = "/tmp/record-test-output.md";
const OUTPUT_DIR = "/tmp/record-test-dir";
const OUTPUT_NESTED = join(OUTPUT_DIR, "nested", "proof.md");

function cleanup() {
  try { unlinkSync(OUTPUT); } catch {}
  try { unlinkSync(OUTPUT_NESTED); } catch {}
}

afterEach(cleanup);
afterAll(cleanup);

describe("record interface", () => {
  it("writes markdown with auto-instrumented events", async () => {
    const sqlPath = "/tmp/record-test-sql.db";
    const p = await probes({
      record: { output_path: OUTPUT },
      sql: { path: sqlPath },
    });

    p.record.begin({ test_name: "auto-instrumented test" });
    try {
      const rows = await p.sql.read({ table: "nonexistent" });
      p.record.end({ result: "pass" });
    } catch {
      p.record.end({ result: "fail", error: "unexpected" });
    }

    await p.record.write();
    await p.close();

    expect(existsSync(OUTPUT)).toBe(true);
    const md = readFileSync(OUTPUT, "utf8");
    expect(md).toContain("auto-instrumented test");
    expect(md).toContain("### Sequence");
    expect(md).toContain("sql:nonexistent");
    try { unlinkSync(sqlPath); } catch {}
  });

  it("records error on failure", async () => {
    const p = await probes({ record: { output_path: OUTPUT } });

    p.record.begin({ test_name: "fail test" });
    p.record.end({ result: "fail", error: "something broke" });

    await p.record.write();
    await p.close();

    const md = readFileSync(OUTPUT, "utf8");
    expect(md).toContain("✗ fail");
    expect(md).toContain("something broke");
  });

  it("creates parent directories for nested output path", async () => {
    const p = await probes({ record: { output_path: OUTPUT_NESTED } });

    p.record.begin({ test_name: "nested dir test" });
    p.record.end({ result: "pass" });

    await p.record.write();
    await p.close();

    expect(existsSync(OUTPUT_NESTED)).toBe(true);
  });

  it("handles multiple tests in one suite", async () => {
    const p = await probes({ record: { output_path: OUTPUT } });

    p.record.begin({ test_name: "test one" });
    p.record.end({ result: "pass" });

    p.record.begin({ test_name: "test two" });
    p.record.end({ result: "fail", error: "bad" });

    await p.record.write();
    await p.close();

    const md = readFileSync(OUTPUT, "utf8");
    expect(md).toContain("## test one");
    expect(md).toContain("## test two");
    expect(md).toContain("2 run, 1 pass, 1 fail");
  });

  it("throws when record not configured", async () => {
    const p = await probes({ unix: { client: { path: "/tmp/x.sock" } } });
    expect(() => p.record.begin({ test_name: "test" })).toThrow(/not configured/);
    await p.close();
  });

  it("clears buffer after write", async () => {
    const p = await probes({ record: { output_path: OUTPUT } });

    p.record.begin({ test_name: "first batch" });
    p.record.end({ result: "pass" });
    await p.record.write();

    p.record.begin({ test_name: "second batch" });
    p.record.end({ result: "pass" });
    await p.record.write();

    await p.close();

    const md = readFileSync(OUTPUT, "utf8");
    expect(md).toContain("## second batch");
    expect(md).toContain("1 run, 1 pass, 0 fail");
    expect(md.match(/## /g)?.length).toBe(1);
  });
});
