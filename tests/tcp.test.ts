import { describe, it, expect } from "bun:test";
import { validateConfig } from "../src/config";

describe("tcp config validation", () => {
  it("accepts valid tcp config", () => {
    const config = validateConfig({
      tcp: [
        { name: "mongo_mock", port: 27017, handshake: "mongodb" },
      ],
    });
    expect(config.tcp).toHaveLength(1);
    expect(config.tcp![0].name).toBe("mongo_mock");
  });

  it("accepts tcp config with idle_timeout_ms", () => {
    const config = validateConfig({
      tcp: [
        { name: "svc", port: 9000, idle_timeout_ms: 5000 },
      ],
    });
    expect(config.tcp![0].idle_timeout_ms).toBe(5000);
  });

  it("accepts tcp config without handshake", () => {
    const config = validateConfig({
      tcp: [{ name: "raw_svc", port: 9000 }],
    });
    expect(config.tcp![0].handshake).toBeUndefined();
  });

  it("rejects duplicate tcp target names", () => {
    expect(() =>
      validateConfig({
        tcp: [
          { name: "dup", port: 9000 },
          { name: "dup", port: 9001 },
        ],
      })
    ).toThrow();
  });

  it("rejects port out of range", () => {
    expect(() =>
      validateConfig({ tcp: [{ name: "bad", port: 99999 }] })
    ).toThrow();
  });

  it("rejects empty tcp array", () => {
    expect(() => validateConfig({ tcp: [] })).toThrow();
  });
});
