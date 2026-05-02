import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { probes } from "../src/lib";
import type { ProbesInstance } from "../src/interfaces/types";

const MOCK_WS_PORT = 19578;
let p: ProbesInstance;
let mockServer: ReturnType<typeof Bun.serve>;
let mockSocket: any;
let serverMessages: { data: any; type: string }[] = [];

describe("WS client interface", () => {
  beforeAll(async () => {
    mockServer = Bun.serve({
      port: MOCK_WS_PORT,
      fetch(req, server) {
        server.upgrade(req);
        return undefined as any;
      },
      websocket: {
        open(ws) {
          mockSocket = ws;
        },
        message(ws, message) {
          serverMessages.push({
            data: message,
            type: typeof message === "string" ? "text" : "binary",
          });
        },
        close(ws) {},
      },
    });

    p = await probes({
      ws: {
        client: [{ name: "mock_server", url: `ws://127.0.0.1:${MOCK_WS_PORT}` }],
      },
    });

    await new Promise((r) => setTimeout(r, 150));
  });

  afterAll(async () => {
    await p.close();
    mockServer.stop();
  });

  test("send text to server", async () => {
    serverMessages = [];
    await p.ws.client!.send({ target: "mock_server", data: "hello from probe" });
    await new Promise((r) => setTimeout(r, 50));
    expect(serverMessages.length).toBe(1);
    expect(serverMessages[0].type).toBe("text");
    expect(serverMessages[0].data).toBe("hello from probe");
  });

  test("watch text message from server", async () => {
    const watchPromise = (async () => {
      const iter = p.ws.client!.watch({ target: "mock_server", timeout_ms: 5000 });
      const result = await iter[Symbol.asyncIterator]().next();
      return result.value;
    })();

    await new Promise((r) => setTimeout(r, 50));
    mockSocket.send("hello from server");

    const msg = await watchPromise;
    expect(msg.type).toBe("text");
    expect(msg.data).toBe("hello from server");
    expect(msg.timestamp).toBeGreaterThan(0);
  });

  test("send binary to server", async () => {
    serverMessages = [];
    const binaryData = Buffer.from([0xca, 0xfe]).toString("base64");
    await p.ws.client!.send({ target: "mock_server", data: binaryData, binary: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(serverMessages.length).toBe(1);
    expect(serverMessages[0].type).toBe("binary");
    expect(Buffer.from(serverMessages[0].data as ArrayBuffer)).toEqual(
      Buffer.from([0xca, 0xfe])
    );
  });

  test("watch binary message from server", async () => {
    const watchPromise = (async () => {
      const iter = p.ws.client!.watch({ target: "mock_server", timeout_ms: 5000 });
      const result = await iter[Symbol.asyncIterator]().next();
      return result.value;
    })();

    await new Promise((r) => setTimeout(r, 50));
    mockSocket.send(new Uint8Array([0xbe, 0xef]));

    const msg = await watchPromise;
    expect(msg.type).toBe("binary");
    expect(msg.data_base64).toBeDefined();
    expect(Buffer.from(msg.data_base64!, "base64")).toEqual(
      Buffer.from([0xbe, 0xef])
    );
  });

  test("reset clears buffered message", async () => {
    mockSocket.send("buffer me");
    await new Promise((r) => setTimeout(r, 100));

    await p.ws.client!.reset({ target: "mock_server" });

    const iter = p.ws.client!.watch({ target: "mock_server", timeout_ms: 500 });
    await expect(
      iter[Symbol.asyncIterator]().next()
    ).rejects.toThrow(/timeout/i);
  });

  test("target not found throws", async () => {
    await expect(
      p.ws.client!.send({ target: "nonexistent", data: "test" })
    ).rejects.toThrow("WS target not found: nonexistent");
  });
});
