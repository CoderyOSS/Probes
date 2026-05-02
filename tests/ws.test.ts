import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { probes } from "../src/lib";
import type { ProbesInstance } from "../src/interfaces/types";

const WS_PORT = 19577;
let p: ProbesInstance;

describe("WS interface", () => {
  beforeAll(async () => {
    p = await probes({
      ws: [{ name: "test_ws", port: WS_PORT }],
    });
  });

  afterAll(async () => {
    await p.close();
  });

  test("send and watch text message", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);

    await new Promise<void>((resolve) => {
      ws.addEventListener("open", () => resolve(), { once: true });
    });

    const watchPromise = (async () => {
      const iter = p.ws.watch({ target: "test_ws", timeout_ms: 5000 });
      const result = await iter[Symbol.asyncIterator]().next();
      return result.value;
    })();

    ws.send("hello from client");
    const msg = await watchPromise;

    expect(msg.type).toBe("text");
    expect(msg.data).toBe("hello from client");
    expect(msg.timestamp).toBeGreaterThan(0);

    ws.close();
  });

  test("send from server to client", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);

    const messagePromise = new Promise<string>((resolve) => {
      ws.addEventListener("message", (e) => resolve(e.data as string), { once: true });
    });

    await new Promise<void>((resolve) => {
      ws.addEventListener("open", () => resolve(), { once: true });
    });

    await p.ws.send({ target: "test_ws", data: "from server" });

    const received = await messagePromise;
    expect(received).toBe("from server");

    ws.close();
  });

  test("send binary from server to client", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);

    const messagePromise = new Promise<ArrayBuffer>((resolve) => {
      ws.addEventListener("message", (e) => resolve(e.data as ArrayBuffer), { once: true });
    });

    await new Promise<void>((resolve) => {
      ws.addEventListener("open", () => resolve(), { once: true });
    });

    const binaryData = Buffer.from([0x01, 0x02, 0x03]).toString("base64");
    await p.ws.send({ target: "test_ws", data: binaryData, binary: true });

    const received = await messagePromise;
    expect(new Uint8Array(received)).toEqual(new Uint8Array([0x01, 0x02, 0x03]));

    ws.close();
  });

  test("watch captures binary message", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);

    await new Promise<void>((resolve) => {
      ws.addEventListener("open", () => resolve(), { once: true });
    });

    const watchPromise = (async () => {
      const iter = p.ws.watch({ target: "test_ws", timeout_ms: 5000 });
      const result = await iter[Symbol.asyncIterator]().next();
      return result.value;
    })();

    ws.send(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    const msg = await watchPromise;

    expect(msg.type).toBe("binary");
    expect(msg.data_base64).toBeDefined();
    expect(Buffer.from(msg.data_base64!, "base64")).toEqual(
      Buffer.from([0xde, 0xad, 0xbe, 0xef])
    );

    ws.close();
  });

  test("reset clears buffered message", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);

    await new Promise<void>((resolve) => {
      ws.addEventListener("open", () => resolve(), { once: true });
    });

    ws.send("buffer me");
    await new Promise((r) => setTimeout(r, 100));

    await p.ws.reset({ target: "test_ws" });

    const iter = p.ws.watch({ target: "test_ws", timeout_ms: 500 });
    await expect(
      iter[Symbol.asyncIterator]().next()
    ).rejects.toThrow(/timeout/i);

    ws.close();
  });

  test("target not found throws", async () => {
    await expect(
      p.ws.send({ target: "nonexistent", data: "test" })
    ).rejects.toThrow("WS target not found: nonexistent");
  });
});
