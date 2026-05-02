import { describe, it, expect } from "bun:test";
import { validateConfig } from "../src/config";
import { createTcpInterface } from "../src/interfaces/tcp";
import { createConnection } from "node:net";

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

describe("tcp raw interface", () => {
  it("captures incoming data via watch", async () => {
    const tcp = createTcpInterface([{ name: "raw_test", port: 29001 }]);

    try {
      const watchIter = tcp.watch({ target: "raw_test", timeout_ms: 3000 });
      const watchPromise = watchIter[Symbol.asyncIterator]().next();

      await new Promise<void>((resolve) => {
        const client = createConnection(
          { port: 29001, host: "127.0.0.1" },
          () => {
            client.write(Buffer.from("hello tcp"));
            resolve();
          }
        );
        setTimeout(() => {
          client.destroy();
        }, 200);
      });

      const result = await watchPromise;
      expect(result.value.data).toBeDefined();
      const decoded = Buffer.from(result.value.data, "base64").toString();
      expect(decoded).toBe("hello tcp");
      expect(result.value.remote).toContain("127.0.0.1");
    } finally {
      tcp.close();
    }
  });

  it("sends data to connected client via send", async () => {
    const tcp = createTcpInterface([{ name: "send_test", port: 29002 }]);

    try {
      const received = await new Promise<string>((resolve, reject) => {
        const client = createConnection(
          { port: 29002, host: "127.0.0.1" },
          () => {
            client.on("data", (data: Buffer) => {
              resolve(data.toString());
            });
          }
        );

        setTimeout(async () => {
          await tcp.send({
            target: "send_test",
            data: Buffer.from("response payload").toString("base64"),
          });
        }, 100);

        setTimeout(() => {
          client.destroy();
          reject(new Error("send timeout"));
        }, 2000);
      });

      expect(received).toBe("response payload");
    } finally {
      tcp.close();
    }
  });

  it("watch times out when no data arrives", async () => {
    const tcp = createTcpInterface([{ name: "timeout_test", port: 29003 }]);

    try {
      const watchIter = tcp.watch({ target: "timeout_test", timeout_ms: 500 });
      await expect(
        watchIter[Symbol.asyncIterator]().next()
      ).rejects.toThrow(/timeout/i);
    } finally {
      tcp.close();
    }
  });

  it("supports multiple targets on different ports", async () => {
    const tcp = createTcpInterface([
      { name: "target_a", port: 29004 },
      { name: "target_b", port: 29005 },
    ]);

    try {
      const watchA = tcp.watch({ target: "target_a", timeout_ms: 3000 });
      const watchB = tcp.watch({ target: "target_b", timeout_ms: 3000 });
      const iterA = watchA[Symbol.asyncIterator]().next();
      const iterB = watchB[Symbol.asyncIterator]().next();

      await new Promise<void>((resolve) => {
        const c1 = createConnection({ port: 29004, host: "127.0.0.1" }, () => {
          c1.write(Buffer.from("aaa"));
          setTimeout(() => c1.destroy(), 200);
        });
        const c2 = createConnection({ port: 29005, host: "127.0.0.1" }, () => {
          c2.write(Buffer.from("bbb"));
          setTimeout(() => c2.destroy(), 200);
        });
        setTimeout(resolve, 300);
      });

      const resA = await iterA;
      const resB = await iterB;
      expect(Buffer.from(resA.value.data, "base64").toString()).toBe("aaa");
      expect(Buffer.from(resB.value.data, "base64").toString()).toBe("bbb");
    } finally {
      tcp.close();
    }
  });

  it("throws on unknown target name", () => {
    const tcp = createTcpInterface([{ name: "only", port: 29006 }]);

    try {
      expect(() =>
        tcp.watch({ target: "nonexistent", timeout_ms: 100 })
      ).toThrow();
      expect(() => tcp.send({ target: "nonexistent", data: "" })).toThrow();
    } finally {
      tcp.close();
    }
  });
});
