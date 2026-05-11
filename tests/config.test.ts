import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, validateConfig } from "../src/config";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TMP = join(import.meta.dir, "__tmp_config_test__");

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe("loadConfig", () => {
  it("loads YAML config from file", () => {
    writeFileSync(
      join(TMP, "probes.yml"),
      `interfaces:\n  http:\n    client:\n      base_url: "http://localhost:3000"\n  sql:\n    path: "./test.db"\n`
    );
    const config = loadConfig(join(TMP, "probes.yml"));
    expect(config.interfaces?.http?.client?.base_url).toBe("http://localhost:3000");
    expect(config.interfaces?.sql?.path).toBe("./test.db");
  });

  it("loads JSON config from file", () => {
    writeFileSync(
      join(TMP, "probes.json"),
      JSON.stringify({ interfaces: { sql: { path: "./test.db" } } })
    );
    const config = loadConfig(join(TMP, "probes.json"));
    expect(config.interfaces?.sql?.path).toBe("./test.db");
  });

  it("throws on missing file", () => {
    expect(() => loadConfig(join(TMP, "nope.yml"))).toThrow();
  });

  it("throws on invalid extension", () => {
    writeFileSync(join(TMP, "probes.toml"), "hello = true");
    expect(() => loadConfig(join(TMP, "probes.toml"))).toThrow();
  });
});

describe("validateConfig", () => {
  it("accepts valid partial config", () => {
    const config = validateConfig({
      interfaces: { http: { client: { base_url: "http://localhost:3000" } } },
    });
    expect(config.interfaces?.http?.client?.base_url).toBe("http://localhost:3000");
  });

  it("accepts empty config", () => {
    const config = validateConfig({});
    expect(config.proof).toEqual({ output: "proof-records.md" });
  });

  it("rejects invalid interfaces.http.client.base_url", () => {
    expect(() =>
      validateConfig({ interfaces: { http: { client: { base_url: "not-a-url" } } } })
    ).toThrow();
  });

  it("rejects unknown top-level keys", () => {
    expect(() =>
      validateConfig({ interfaces: { http: {} as any }, unknown_thing: true } as any)
    ).toThrow();
  });

  it("rejects interfaces.sql.path with traversal", () => {
    expect(() =>
      validateConfig({ interfaces: { sql: { path: "../etc/passwd" } } })
    ).toThrow();
  });

  it("rejects interfaces.fs.root with traversal", () => {
    expect(() =>
      validateConfig({ interfaces: { fs: { root: "../../etc" } } })
    ).toThrow();
  });
});
