import { describe, it, expect, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { probes } from "../src/lib";

const CLIENT_PATH = "/tmp/unix-test-client.sock";
const SERVER_PATH = "/tmp/unix-test-server.sock";

function cleanup(paths: string[]) {
  for (const p of paths) {
    try { unlinkSync(p); } catch {}
  }
}

const cleanupPaths = [CLIENT_PATH, SERVER_PATH];
afterEach(() => cleanup(cleanupPaths));

function makeServerAck(path: string) {
  return Bun.listen({
    unix: path,
    socket: {
      data(socket, data) {
        const msg = Buffer.from(data).toString();
        socket.write(Buffer.from("ack:" + msg));
        socket.end();
      },
    },
  });
}

describe("unix client mode", () => {
  it("sends data and receives response", async () => {
    const server = makeServerAck(CLIENT_PATH);
    try {
      const p = await probes({ unix: { client: { path: CLIENT_PATH } } });
      try {
        const res = await p.unix.send({ data: "hello" });
        expect(res).toBe("ack:hello");
      } finally {
        await p.close();
      }
    } finally {
      server.stop();
    }
  });

  it("uses explicit path override", async () => {
    const server = makeServerAck("/tmp/override.sock");
    cleanupPaths.push("/tmp/override.sock");
    try {
      const p = await probes({ unix: { client: { path: CLIENT_PATH } } });
      try {
        const res = await p.unix.send({ data: "overridden", path: "/tmp/override.sock" });
        expect(res).toBe("ack:overridden");
      } finally {
        await p.close();
      }
    } finally {
      server.stop();
    }
  });

  it("throws when no path configured or provided", async () => {
    const p = await probes({ unix: { server: [{ name: "test", path: SERVER_PATH }] } });
    try {
      await expect(p.unix.send({ data: "test" })).rejects.toThrow(
        /path not provided/
      );
    } finally {
      await p.close();
    }
  });

  it("send_json encodes and decodes JSON", async () => {
    const server = Bun.listen({
      unix: CLIENT_PATH,
      socket: {
        data(socket, raw) {
          const msg = Buffer.from(raw).toString();
          const parsed = JSON.parse(msg.trimEnd());
          const reply = { result: parsed.value * 2 };
          socket.write(Buffer.from(JSON.stringify(reply) + "\n"));
          socket.end();
        },
      },
    });
    try {
      const p = await probes({ unix: { client: { path: CLIENT_PATH } } });
      try {
        const res = await p.unix.send_json({ data: { value: 21 } });
        expect(res).toEqual({ result: 42 });
      } finally {
        await p.close();
      }
    } finally {
      server.stop();
    }
  });

  it("times out on unresponsive server", async () => {
    cleanupPaths.push("/tmp/unresponsive.sock");
    // Create a server that never responds
    const server = Bun.listen({
      unix: "/tmp/unresponsive.sock",
      socket: {
        data(_socket, _data) {
          // never respond
        },
      },
    });
    try {
      const p = await probes({ unix: { client: { path: "/tmp/unresponsive.sock", timeout_ms: 500 } } });
      try {
        await expect(p.unix.send({ data: "test", timeout_ms: 100 })).rejects.toThrow(
          /timeout|connect|error/i
        );
      } finally {
        await p.close();
      }
    } finally {
      server.stop();
    }
  });
});

describe("unix server mode", () => {
  it("watch captures incoming data", async () => {
    cleanupPaths.push(SERVER_PATH);
    const p = await probes({
      unix: { server: [{ name: "test-unix", path: SERVER_PATH }] },
    });
    try {
      const watchPromise = (async () => {
        const iter = p.unix.watch({ target: "test-unix", timeout_ms: 5000 });
        const result = await iter[Symbol.asyncIterator]().next();
        return result;
      })();

      await new Promise((r) => setTimeout(r, 100));

      await Bun.connect({
        unix: SERVER_PATH,
        socket: {
          open(socket) {
            socket.write(Buffer.from("watched-data"));
            socket.end();
          },
          data() {},
        },
      });

      const result = await watchPromise;
      expect(result.done).toBe(false);
      expect(Buffer.from(result.value!.data, "base64").toString()).toBe(
        "watched-data"
      );
    } finally {
      await p.close();
    }
  });

  it("watch buffers data when no watcher waiting", async () => {
    cleanupPaths.push(SERVER_PATH);
    const p = await probes({
      unix: { server: [{ name: "buf-test", path: SERVER_PATH }] },
    });
    try {
      await Bun.connect({
        unix: SERVER_PATH,
        socket: {
          open(socket) {
            socket.write(Buffer.from("buffered-message"));
            socket.end();
          },
          data() {},
        },
      });

      await new Promise((r) => setTimeout(r, 100));

      const iter = p.unix.watch({ target: "buf-test", timeout_ms: 1000 });
      const result = await iter[Symbol.asyncIterator]().next();
      expect(result.done).toBe(false);
      expect(Buffer.from(result.value!.data, "base64").toString()).toBe(
        "buffered-message"
      );
    } finally {
      await p.close();
    }
  });

  it("throws for unknown target", async () => {
    const p = await probes({
      unix: { server: [{ name: "only", path: SERVER_PATH }] },
    });
    try {
      expect(() => p.unix.watch({ target: "nonexistent" })).toThrow(
        /not found/
      );
    } finally {
      await p.close();
    }
  });

  it("server target names must be unique", async () => {
    await expect(
      probes({
        unix: {
          server: [
            { name: "dup", path: "/tmp/a.sock" },
            { name: "dup", path: "/tmp/b.sock" },
          ],
        },
      })
    ).rejects.toThrow(/unique/i);
  });

  it("cleans up socket path on close", async () => {
    cleanupPaths.push(SERVER_PATH);
    const p = await probes({
      unix: { server: [{ name: "cleanup", path: SERVER_PATH }] },
    });
    expect(existsSync(SERVER_PATH)).toBe(true);
    await p.close();
    expect(existsSync(SERVER_PATH)).toBe(false);
  });
});
