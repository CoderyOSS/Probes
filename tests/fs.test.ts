import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { createFsInterface } from "../src/interfaces/fs";
import type { FsConfig } from "../src/interfaces/types";

const ROOT = join(import.meta.dir, "__tmp_fs_test__");

beforeEach(() => mkdirSync(ROOT, { recursive: true }));
afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

function makeFs(config?: Partial<FsConfig>) {
  return createFsInterface({
    root: ROOT,
    reset_on_start: false,
    ...config,
  });
}

describe("fs.put", () => {
  it("writes file content", async () => {
    const fs = makeFs();
    await fs.put({ path: "hello.txt", content: "Hello, World!" });

    const content = await fs.read({ path: "hello.txt" });
    expect(content).toBe("Hello, World!");
  });

  it("creates parent directories", async () => {
    const fs = makeFs();
    await fs.put({
      path: "deep/nested/dir/file.txt",
      content: "deep",
    });

    const content = await fs.read({ path: "deep/nested/dir/file.txt" });
    expect(content).toBe("deep");
  });

  it("overwrites existing file", async () => {
    const fs = makeFs();
    await fs.put({ path: "file.txt", content: "first" });
    await fs.put({ path: "file.txt", content: "second" });

    const content = await fs.read({ path: "file.txt" });
    expect(content).toBe("second");
  });

  it("rejects path traversal", async () => {
    const fs = makeFs();
    expect(fs.put({ path: "../etc/passwd", content: "nope" })).rejects.toThrow();
  });
});

describe("fs.read", () => {
  it("reads existing file", async () => {
    const fs = makeFs();
    await fs.put({ path: "data.txt", content: "some data" });

    const content = await fs.read({ path: "data.txt" });
    expect(content).toBe("some data");
  });

  it("throws on missing file", async () => {
    const fs = makeFs();
    expect(fs.read({ path: "nonexistent.txt" })).rejects.toThrow();
  });
});

describe("fs.reset", () => {
  it("deletes specific file", async () => {
    const fs = makeFs();
    await fs.put({ path: "a.txt", content: "a" });
    await fs.put({ path: "b.txt", content: "b" });

    await fs.reset({ path: "a.txt" });

    expect(existsSync(join(ROOT, "a.txt"))).toBe(false);
    expect(existsSync(join(ROOT, "b.txt"))).toBe(true);
  });

  it("wipes all files when no path specified", async () => {
    const fs = makeFs();
    await fs.put({ path: "a.txt", content: "a" });
    await fs.put({ path: "sub/b.txt", content: "b" });

    await fs.reset();

    expect(existsSync(join(ROOT, "a.txt"))).toBe(false);
    expect(existsSync(join(ROOT, "sub"))).toBe(false);
  });
});

describe("fs.watch", () => {
  it("returns new content when file changes", async () => {
    const fs = makeFs();
    await fs.put({ path: "watch.txt", content: "initial" });

    const watchPromise = fs.watch({
      path: "watch.txt",
      timeout_ms: 3000,
    });

    await new Promise((r) => setTimeout(r, 100));
    await fs.put({ path: "watch.txt", content: "changed" });

    const result = await watchPromise;
    expect(result).toBe("changed");
  });

  it("times out when no change", async () => {
    const fs = makeFs();
    await fs.put({ path: "static.txt", content: "static" });

    await expect(
      fs.watch({ path: "static.txt", timeout_ms: 200 })
    ).rejects.toThrow(/timeout/i);
  });
});
