# TCP Socket Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic TCP socket interface to @codery/probes that listens on configured ports, captures incoming bytes via `watch()`, and pushes bytes to clients via `send()`.

**Architecture:** New `tcp` interface module using Node `net.Server` for raw TCP. Multiple named targets each bind a localhost port. Pluggable handshake modules handle initial protocol negotiation for MongoDB, Redis, PostgreSQL. The `watch()` method returns an `AsyncIterable` that yields captured data chunks. The `send()` method broadcasts bytes to all connected clients on a target.

**Tech Stack:** TypeScript, Bun runtime, Node `net` module, Zod for config validation, Bun test runner.

**Spec:** `docs/superpowers/specs/2026-05-01-tcp-socket-interface-design.md`

---

### Task 1: Types and Config

**Files:**
- Modify: `src/interfaces/types.ts`
- Modify: `src/config.ts`
- Create: `tests/tcp.test.ts`

- [ ] **Step 1: Add TCP types to types.ts**

Append to `src/interfaces/types.ts`:

```ts
export interface TcpTargetConfig {
  name: string;
  port: number;
  handshake?: string;
  idle_timeout_ms?: number;
}

export interface TcpConfig {
  tcp: TcpTargetConfig[];
}

export interface CapturedTcpData {
  data: string;
  timestamp: number;
  remote: string;
}
```

Also update `ProbesConfig` to include `tcp?: TcpConfig`:

```ts
export interface ProbesConfig {
  http?: HttpConfig;
  sql?: SqlConfig;
  fs?: FsConfig;
  tcp?: TcpConfig;
}
```

Add `tcp` property to `ProbesInstance` interface. Insert after `fs` property, before `configure`:

```ts
  tcp: {
    send: (params: { target: string; data: string }) => Promise<void>;
    watch: (params: { target: string; timeout_ms?: number }) => AsyncIterable<CapturedTcpData>;
  };
```

- [ ] **Step 2: Add TCP config schema to config.ts**

Add `TcpTargetSchema` and `TcpSchema` before `ProbesConfigSchema`. Import `TcpTargetConfig` not needed since config only deals with raw validation.

```ts
const TcpTargetSchema = z.object({
  name: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  handshake: z.string().optional(),
  idle_timeout_ms: z.number().int().positive().optional(),
});

const TcpSchema = z.array(TcpTargetSchema).min(1).refine(
  (targets) => {
    const names = targets.map((t) => t.name);
    return new Set(names).size === names.length;
  },
  { message: "TCP target names must be unique" }
);
```

Add `tcp: TcpSchema.optional()` to `ProbesConfigSchema`.

- [ ] **Step 3: Write config validation test**

Add to `tests/tcp.test.ts`:

```ts
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

  it("accepts tcp config without handshake (defaults to raw)", () => {
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
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/tcp.test.ts tests/config.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/interfaces/types.ts src/config.ts tests/tcp.test.ts
git commit -m "feat: add TCP types and config validation"
```

---

### Task 2: TCP Interface Core (raw mode, no handshakes)

**Files:**
- Create: `src/interfaces/tcp.ts`
- Modify: `tests/tcp.test.ts`

- [ ] **Step 1: Write test for raw TCP send and watch**

Add to `tests/tcp.test.ts`. Import `createTcpInterface` and `net` from node:

```ts
import { createTcpInterface } from "../src/interfaces/tcp";
import { createConnection } from "node:net";
```

Add describe block:

```ts
describe("tcp raw interface", () => {
  it("captures incoming data via watch", async () => {
    const tcp = createTcpInterface({
      tcp: [{ name: "raw_test", port: 29001 }],
    });

    try {
      const watchIter = tcp.watch({ target: "raw_test", timeout_ms: 3000 });
      const watchPromise = watchIter[Symbol.asyncIterator]().next();

      await new Promise<void>((resolve) => {
        const client = createConnection({ port: 29001, host: "127.0.0.1" }, () => {
          client.write(Buffer.from("hello tcp"));
          resolve();
        });
        setTimeout(() => { client.destroy(); }, 200);
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
    const tcp = createTcpInterface({
      tcp: [{ name: "send_test", port: 29002 }],
    });

    try {
      const received = await new Promise<string>((resolve) => {
        const client = createConnection({ port: 29002, host: "127.0.0.1" }, () => {
          client.on("data", (data: Buffer) => {
            resolve(data.toString());
          });
        });

        setTimeout(async () => {
          await tcp.send({
            target: "send_test",
            data: Buffer.from("response payload").toString("base64"),
          });
        }, 100);

        setTimeout(() => { client.destroy(); }, 2000);
      });

      expect(received).toBe("response payload");
    } finally {
      tcp.close();
    }
  });

  it("watch times out when no data arrives", async () => {
    const tcp = createTcpInterface({
      tcp: [{ name: "timeout_test", port: 29003 }],
    });

    try {
      const watchIter = tcp.watch({ target: "timeout_test", timeout_ms: 500 });
      await expect(watchIter[Symbol.asyncIterator]().next()).rejects.toThrow(/timeout/i);
    } finally {
      tcp.close();
    }
  });

  it("supports multiple targets on different ports", async () => {
    const tcp = createTcpInterface({
      tcp: [
        { name: "target_a", port: 29004 },
        { name: "target_b", port: 29005 },
      ],
    });

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

  it("throws on unknown target name", async () => {
    const tcp = createTcpInterface({
      tcp: [{ name: "only", port: 29006 }],
    });

    try {
      expect(() => tcp.watch({ target: "nonexistent", timeout_ms: 100 })).toThrow();
      expect(() => tcp.send({ target: "nonexistent", data: "" })).toThrow();
    } finally {
      tcp.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tcp.test.ts`
Expected: FAIL — `createTcpInterface` not exported.

- [ ] **Step 3: Implement TCP interface**

Create `src/interfaces/tcp.ts`:

```ts
import { createServer, type Socket } from "node:net";
import type { TcpConfig, CapturedTcpData } from "./types";

export interface TcpActions {
  send: (params: { target: string; data: string }) => Promise<void>;
  watch: (params: { target: string; timeout_ms?: number }) => AsyncIterable<CapturedTcpData>;
  close: () => void;
}

interface TargetState {
  name: string;
  server: ReturnType<typeof createServer>;
  sockets: Set<Socket>;
  pendingResolve: ((value: CapturedTcpData) => void) | null;
  pendingReject: ((reason: Error) => void) | null;
  buffered: CapturedTcpData | null;
}

export function createTcpInterface(config: TcpConfig): TcpActions {
  const targets = new Map<string, TargetState>();

  for (const targetConfig of config.tcp) {
    const state: TargetState = {
      name: targetConfig.name,
      server: createServer(),
      sockets: new Set(),
      pendingResolve: null,
      pendingReject: null,
      buffered: null,
    };

    state.server.on("connection", (socket: Socket) => {
      state.sockets.add(socket);

      socket.on("data", (raw: Buffer) => {
        const captured: CapturedTcpData = {
          data: raw.toString("base64"),
          timestamp: Date.now(),
          remote: `${socket.remoteAddress}:${socket.remotePort}`,
        };

        if (state.pendingResolve) {
          state.pendingResolve(captured);
          state.pendingResolve = null;
          state.pendingReject = null;
        } else {
          state.buffered = captured;
        }
      });

      socket.on("close", () => {
        state.sockets.delete(socket);
      });

      if (targetConfig.idle_timeout_ms) {
        socket.setTimeout(targetConfig.idle_timeout_ms);
        socket.on("timeout", () => {
          socket.destroy();
        });
      }
    });

    state.server.listen(targetConfig.port, "127.0.0.1");
    targets.set(targetConfig.name, state);
  }

  return {
    async send({ target, data }) {
      const state = targets.get(target);
      if (!state) throw new Error(`TCP target not found: ${target}`);
      const buf = Buffer.from(data, "base64");
      for (const socket of state.sockets) {
        socket.write(buf);
      }
    },

    watch({ target, timeout_ms = 30000 }): AsyncIterable<CapturedTcpData> {
      const state = targets.get(target);
      if (!state) throw new Error(`TCP target not found: ${target}`);

      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (state.buffered) {
                const captured = state.buffered;
                state.buffered = null;
                return { value: captured, done: false };
              }

              return new Promise<{ value: CapturedTcpData; done: false }>(
                (resolve, reject) => {
                  const timer = setTimeout(() => {
                    state.pendingResolve = null;
                    state.pendingReject = null;
                    reject(new Error(`Watch timeout: no data received within ${timeout_ms}ms`));
                  }, timeout_ms);

                  state.pendingReject = (err: Error) => {
                    clearTimeout(timer);
                    reject(err);
                  };

                  state.pendingResolve = (captured: CapturedTcpData) => {
                    clearTimeout(timer);
                    resolve({ value: captured, done: false });
                  };
                }
              );
            },
            return() {
              if (state.pendingReject) {
                state.pendingReject(new Error("Watch cancelled"));
                state.pendingResolve = null;
                state.pendingReject = null;
              }
              return { value: undefined, done: true as const };
            },
          };
        },
      };
    },

    close() {
      for (const state of targets.values()) {
        for (const socket of state.sockets) {
          socket.destroy();
        }
        state.server.close();
        if (state.pendingReject) {
          state.pendingReject(new Error("TCP interface closed"));
          state.pendingResolve = null;
          state.pendingReject = null;
        }
      }
      targets.clear();
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/tcp.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/interfaces/tcp.ts tests/tcp.test.ts
git commit -m "feat: TCP interface core with send() and watch()"
```

---

### Task 3: Handshake Module System

**Files:**
- Create: `src/interfaces/handshakes/index.ts`
- Create: `src/interfaces/handshakes/raw.ts`
- Modify: `tests/tcp.test.ts`

- [ ] **Step 1: Define handshake types and registry**

Create `src/interfaces/handshakes/index.ts`:

```ts
import type { Socket } from "node:net";

export interface HandshakeModule {
  name: string;
  handle(socket: Socket): Promise<void>;
}

const registry = new Map<string, HandshakeModule>();

export function registerHandshake(module: HandshakeModule): void {
  registry.set(module.name, module);
}

export function resolveHandshake(name: string): HandshakeModule | null {
  return registry.get(name) ?? null;
}

export function getRegisteredHandshakes(): string[] {
  return [...registry.keys()];
}

import "./raw.js";

export { registry };
```

Create `src/interfaces/handshakes/raw.ts`:

```ts
import type { HandshakeModule } from "./index.js";

const rawHandshake: HandshakeModule = {
  name: "raw",
  async handle() {
    // No handshake — bytes pass through immediately
  },
};

import { registerHandshake } from "./index.js";
registerHandshake(rawHandshake);
```

- [ ] **Step 2: Write test for handshake resolution**

Add to `tests/tcp.test.ts`:

```ts
import { resolveHandshake, getRegisteredHandshakes } from "../src/interfaces/handshakes/index";
```

```ts
describe("handshake registry", () => {
  it("resolves raw handshake", () => {
    const mod = resolveHandshake("raw");
    expect(mod).not.toBeNull();
    expect(mod!.name).toBe("raw");
  });

  it("returns null for unknown handshake", () => {
    const mod = resolveHandshake("totally_fake");
    expect(mod).toBeNull();
  });

  it("lists registered handshakes", () => {
    const names = getRegisteredHandshakes();
    expect(names).toContain("raw");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `bun test tests/tcp.test.ts`
Expected: All tests PASS (including handshake registry tests).

- [ ] **Step 4: Integrate handshakes into TCP interface**

Modify `src/interfaces/tcp.ts`. Add import at top:

```ts
import { resolveHandshake } from "./handshakes/index.js";
```

In the `state.server.on("connection")` handler, before the `socket.on("data")` listener, add handshake execution:

```ts
    state.server.on("connection", async (socket: Socket) => {
      state.sockets.add(socket);

      const handshakeName = targetConfig.handshake ?? "raw";
      const handshakeMod = resolveHandshake(handshakeName);
      if (handshakeMod) {
        try {
          await handshakeMod.handle(socket);
        } catch {
          socket.destroy();
          state.sockets.delete(socket);
          return;
        }
      }

      socket.on("data", (raw: Buffer) => {
        // ... existing data handler unchanged
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/tcp.test.ts`
Expected: All tests PASS. Raw handshake is a no-op, existing tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/interfaces/handshakes/ src/interfaces/tcp.ts tests/tcp.test.ts
git commit -m "feat: handshake module system with raw handshake"
```

---

### Task 4: MongoDB Handshake Module

**Files:**
- Create: `src/interfaces/handshakes/mongodb.ts`
- Modify: `tests/tcp.test.ts`

MongoDB wire protocol handshake: client sends an `ismaster`/`hello` command (OP_MSG or legacy OP_QUERY). The handshake module responds with a valid `ismaster` response indicating a standalone server with no auth required.

The response is BSON. We'll build minimal BSON encoding inline (no dependency needed for the small documents we produce).

- [ ] **Step 1: Write MongoDB handshake test**

Add to `tests/tcp.test.ts`:

```ts
import { createConnection } from "node:net";
```

```ts
describe("mongodb handshake", () => {
  it("completes handshake with a client connecting to mongo port", async () => {
    const tcp = createTcpInterface({
      tcp: [{ name: "mongo", port: 29010, handshake: "mongodb" }],
    });

    try {
      const dataReceived = await new Promise<boolean>((resolve, reject) => {
        const client = createConnection({ port: 29010, host: "127.0.0.1" }, () => {
          // MongoDB ismaster command as OP_MSG
          // Header: int32 length, int32 requestID, int32 responseTo, int32 opCode=OP_MSG(2013)
          // OP_MSG: uint32 flags, Section[{uint8 payloadType=0, int32 bsonLength, bson_body}]
          const ismasterBson = buildIsmasterCommand();
          const sectionPayload = Buffer.concat([
            Buffer.from([0x00]), // payload type 0
            Buffer.from(Int32Bytes(ismasterBson.length + 4)),
            ismasterBson,
          ]);
          const opMsgBody = Buffer.concat([
            Buffer.from(Uint32Bytes(0)), // flags
            sectionPayload,
          ]);
          const header = Buffer.concat([
            Buffer.from(Int32Bytes(16 + opMsgBody.length)), // messageLength
            Buffer.from(Int32Bytes(1)), // requestID
            Buffer.from(Int32Bytes(0)), // responseTo
            Buffer.from(Int32Bytes(2013)), // opCode OP_MSG
          ]);
          const msg = Buffer.concat([header, opMsgBody]);
          client.write(msg);
        });

        client.on("data", () => {
          resolve(true);
          client.destroy();
        });

        client.on("error", reject);
        setTimeout(() => { client.destroy(); reject(new Error("timeout")); }, 3000);
      });

      expect(dataReceived).toBe(true);
    } finally {
      tcp.close();
    }
  });
});

function Int32Bytes(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = n & 0xff;
  buf[1] = (n >> 8) & 0xff;
  buf[2] = (n >> 16) & 0xff;
  buf[3] = (n >> 24) & 0xff;
  return buf;
}

function Uint32Bytes(n: number): Uint8Array {
  return Int32Bytes(n);
}

function buildIsmasterCommand(): Buffer {
  // Minimal BSON: { ismaster: 1, helloOk: true }
  // BSON format: int32 length, then elements, then 0x00 terminator
  // Element: uint8 type, cstring key, value

  const elements: Buffer[] = [];

  // ismaster: int32 (type 0x10)
  const ismasterKey = Buffer.from("ismaster\x00");
  const ismasterVal = Buffer.from(Int32Bytes(1));
  elements.push(Buffer.concat([Buffer.from([0x10]), ismasterKey, ismasterVal]));

  // helloOk: boolean (type 0x08)
  const helloOkKey = Buffer.from("helloOk\x00");
  const helloOkVal = Buffer.from([0x01]); // true
  elements.push(Buffer.concat([Buffer.from([0x08]), helloOkKey, helloOkVal]));

  const body = Buffer.concat(elements);
  const length = Buffer.from(Int32Bytes(body.length + 4 + 1)); // +4 for length field, +1 for terminator
  return Buffer.concat([length, body, Buffer.from([0x00])]);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tcp.test.ts`
Expected: FAIL — `mongodb` handshake not registered, client gets no response.

- [ ] **Step 3: Implement MongoDB handshake**

Create `src/interfaces/handshakes/mongodb.ts`:

```ts
import type { Socket } from "node:net";
import type { HandshakeModule } from "./index.js";
import { registerHandshake } from "./index.js";

function writeInt32(buf: Uint8Array, offset: number, n: number): void {
  buf[offset] = n & 0xff;
  buf[offset + 1] = (n >> 8) & 0xff;
  buf[offset + 2] = (n >> 16) & 0xff;
  buf[offset + 3] = (n >> 24) & 0xff;
}

function buildIsmasterResponse(requestId: number): Buffer {
  // BSON body for ismaster response:
  // { ok: 1, ismaster: true, maxWireVersion: 17, minWireVersion: 0, maxBsonObjectSize: 16777216 }
  const bsonElements: Buffer[] = [];

  // ok: double (type 0x01) = 1.0
  const okBuf = Buffer.alloc(8);
  okBuf.writeDoubleLE(1.0, 0);
  bsonElements.push(Buffer.concat([Buffer.from([0x01]), Buffer.from("ok\x00"), okBuf]));

  // ismaster: bool (type 0x08) = true
  bsonElements.push(Buffer.concat([Buffer.from([0x08]), Buffer.from("ismaster\x00"), Buffer.from([0x01])]));

  // maxWireVersion: int32 (type 0x10) = 17
  const maxWire = Buffer.alloc(4);
  maxWire.writeInt32LE(17, 0);
  bsonElements.push(Buffer.concat([Buffer.from([0x10]), Buffer.from("maxWireVersion\x00"), maxWire]));

  // minWireVersion: int32 (type 0x10) = 0
  const minWire = Buffer.alloc(4);
  minWire.writeInt32LE(0, 0);
  bsonElements.push(Buffer.concat([Buffer.from([0x10]), Buffer.from("minWireVersion\x00"), minWire]));

  // maxBsonObjectSize: int32 (type 0x10) = 16777216
  const maxBson = Buffer.alloc(4);
  maxBson.writeInt32LE(16777216, 0);
  bsonElements.push(Buffer.concat([Buffer.from([0x10]), Buffer.from("maxBsonObjectSize\x00"), maxBson]));

  const bsonBody = Buffer.concat(bsonElements);
  const bsonLength = bsonBody.length + 4 + 1; // +4 for length, +1 for terminator
  const bsonLengthBuf = Buffer.alloc(4);
  bsonLengthBuf.writeInt32LE(bsonLength, 0);
  const bsonDoc = Buffer.concat([bsonLengthBuf, bsonBody, Buffer.from([0x00])]);

  // OP_MSG response
  // Section: payloadType=0, bsonLength, bson
  const sectionBsonLen = Buffer.alloc(4);
  sectionBsonLen.writeInt32LE(bsonDoc.length, 0);
  const section = Buffer.concat([Buffer.from([0x00]), sectionBsonLen, bsonDoc]);

  // OP_MSG body: flags(4) + section
  const flags = Buffer.alloc(4);
  const opMsgBody = Buffer.concat([flags, section]);

  // Header: messageLength(4), requestID(4), responseTo(4), opCode(4)
  const header = Buffer.alloc(16);
  header.writeInt32LE(16 + opMsgBody.length, 0); // messageLength
  header.writeInt32LE(1, 4); // response requestID
  header.writeInt32LE(requestId, 8); // responseTo = client's requestID
  header.writeInt32LE(2013, 12); // opCode = OP_MSG

  return Buffer.concat([header, opMsgBody]);
}

function parseRequestId(data: Buffer): number {
  if (data.length < 12) return 0;
  return data.readInt32LE(4); // requestID is at offset 4
}

function parseOpCode(data: Buffer): number {
  if (data.length < 16) return 0;
  return data.readInt32LE(12);
}

const mongodbHandshake: HandshakeModule = {
  name: "mongodb",
  async handle(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.removeListener("data", onData);
        reject(new Error("MongoDB handshake timeout"));
      }, 5000);

      function onData(data: Buffer) {
        const opCode = parseOpCode(data);
        const requestId = parseRequestId(data);

        if (opCode === 2013 || opCode === 2004 || opCode === 2010 || opCode === 2011) {
          // OP_MSG, OP_QUERY, OP_COMMAND, OP_COMMANDREPLY
          const response = buildIsmasterResponse(requestId);
          socket.write(response);
          clearTimeout(timeout);
          socket.removeListener("data", onData);
          resolve();
        }
      }

      socket.on("data", onData);
    });
  },
};

registerHandshake(mongodbHandshake);
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/tcp.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/interfaces/handshakes/mongodb.ts tests/tcp.test.ts
git commit -m "feat: MongoDB wire protocol handshake module"
```

---

### Task 5: Redis Handshake Module

**Files:**
- Create: `src/interfaces/handshakes/redis.ts`
- Modify: `tests/tcp.test.ts`

Redis uses RESP (REdis Serialization Protocol). Handshake needs to handle `PING` → `+PONG` and `AUTH` → `+OK`.

- [ ] **Step 1: Write Redis handshake test**

Add to `tests/tcp.test.ts`:

```ts
describe("redis handshake", () => {
  it("responds to PING with PONG", async () => {
    const tcp = createTcpInterface({
      tcp: [{ name: "redis", port: 29011, handshake: "redis" }],
    });

    try {
      const response = await new Promise<string>((resolve, reject) => {
        const client = createConnection({ port: 29011, host: "127.0.0.1" }, () => {
          client.write(Buffer.from("*1\r\n$4\r\nPING\r\n"));
        });

        client.on("data", (data: Buffer) => {
          resolve(data.toString());
          client.destroy();
        });

        client.on("error", reject);
        setTimeout(() => { client.destroy(); reject(new Error("timeout")); }, 3000);
      });

      expect(response).toBe("+PONG\r\n");
    } finally {
      tcp.close();
    }
  });

  it("responds to AUTH with OK", async () => {
    const tcp = createTcpInterface({
      tcp: [{ name: "redis_auth", port: 29012, handshake: "redis" }],
    });

    try {
      const response = await new Promise<string>((resolve, reject) => {
        const client = createConnection({ port: 29012, host: "127.0.0.1" }, () => {
          client.write(Buffer.from("*2\r\n$4\r\nAUTH\r\n$8\r\nanytoken\r\n"));
        });

        client.on("data", (data: Buffer) => {
          resolve(data.toString());
          client.destroy();
        });

        client.on("error", reject);
        setTimeout(() => { client.destroy(); reject(new Error("timeout")); }, 3000);
      });

      expect(response).toBe("+OK\r\n");
    } finally {
      tcp.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tcp.test.ts`
Expected: FAIL — `redis` handshake not registered.

- [ ] **Step 3: Implement Redis handshake**

Create `src/interfaces/handshakes/redis.ts`:

```ts
import type { Socket } from "node:net";
import type { HandshakeModule } from "./index.js";
import { registerHandshake } from "./index.js";

function parseRespCommand(data: Buffer): string[] {
  const str = data.toString("utf8");
  if (!str.startsWith("*")) return [];

  const lines = str.split("\r\n");
  const commands: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("$")) {
      const nextLine = lines[i + 1];
      if (nextLine) {
        commands.push(nextLine.toUpperCase());
        i++;
      }
    }
  }

  return commands;
}

const redisHandshake: HandshakeModule = {
  name: "redis",
  async handle(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.removeListener("data", onData);
        reject(new Error("Redis handshake timeout"));
      }, 5000);

      let resolved = false;

      function onData(data: Buffer) {
        if (resolved) return;

        const commands = parseRespCommand(data);
        const cmd = commands[0];

        if (cmd === "PING") {
          socket.write(Buffer.from("+PONG\r\n"));
          resolved = true;
          clearTimeout(timeout);
          socket.removeListener("data", onData);
          resolve();
        } else if (cmd === "AUTH") {
          socket.write(Buffer.from("+OK\r\n"));
          resolved = true;
          clearTimeout(timeout);
          socket.removeListener("data", onData);
          resolve();
        } else if (cmd === "CLIENT" || cmd === "CONFIG" || cmd === "INFO" || cmd === "COMMAND") {
          socket.write(Buffer.from("+OK\r\n"));
          resolved = true;
          clearTimeout(timeout);
          socket.removeListener("data", onData);
          resolve();
        }
      }

      socket.on("data", onData);
    });
  },
};

registerHandshake(redisHandshake);
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/tcp.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/interfaces/handshakes/redis.ts tests/tcp.test.ts
git commit -m "feat: Redis RESP handshake module"
```

---

### Task 6: PostgreSQL Handshake Module

**Files:**
- Create: `src/interfaces/handshakes/postgresql.ts`
- Modify: `tests/tcp.test.ts`

PostgreSQL wire protocol: client sends a StartupMessage, server responds with `AuthenticationOk`, `ParameterStatus` messages, `BackendKeyData`, and `ReadyForQuery`.

- [ ] **Step 1: Write PostgreSQL handshake test**

Add to `tests/tcp.test.ts`:

```ts
describe("postgresql handshake", () => {
  it("completes auth handshake with pg client", async () => {
    const tcp = createTcpInterface({
      tcp: [{ name: "pg", port: 29013, handshake: "postgresql" }],
    });

    try {
      const response = await new Promise<Buffer>((resolve, reject) => {
        const client = createConnection({ port: 29013, host: "127.0.0.1" }, () => {
          // StartupMessage: int32 length, int32 protocol(196608 = 3.0), then key\0value\0 pairs, final \0
          const params = Buffer.from("user\0testuser\0database\0testdb\0\0");
          const length = Buffer.alloc(4);
          length.writeInt32BE(4 + 4 + params.length, 0);
          const protocol = Buffer.alloc(4);
          protocol.writeInt32BE(196608, 0);
          client.write(Buffer.concat([length, protocol, params]));
        });

        client.on("data", (data: Buffer) => {
          resolve(data);
          client.destroy();
        });

        client.on("error", reject);
        setTimeout(() => { client.destroy(); reject(new Error("timeout")); }, 3000);
      });

      // First byte should be 'R' (AuthenticationOk)
      expect(response[0]).toBe(0x52); // 'R'
      // Message type 'R', length should be 8 (int32 length + int32 auth ok=0)
      const msgLen = response.readInt32BE(1);
      expect(msgLen).toBe(8);
      const authCode = response.readInt32BE(5);
      expect(authCode).toBe(0); // AuthenticationOk

      // Should contain 'Z' (ReadyForQuery) somewhere
      const zPos = response.indexOf(0x5a);
      expect(zPos).toBeGreaterThan(-1);
    } finally {
      tcp.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tcp.test.ts`
Expected: FAIL — `postgresql` handshake not registered.

- [ ] **Step 3: Implement PostgreSQL handshake**

Create `src/interfaces/handshakes/postgresql.ts`:

```ts
import type { Socket } from "node:net";
import type { HandshakeModule } from "./index.js";
import { registerHandshake } from "./index.js";

function pgMessage(type: string, body: Buffer): Buffer {
  const typeByte = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeInt32BE(body.length + 4, 0);
  return Buffer.concat([typeByte, length, body]);
}

function authOk(): Buffer {
  const code = Buffer.alloc(4);
  code.writeInt32BE(0, 0); // AuthOk
  return pgMessage("R", code);
}

function parameterStatus(name: string, value: string): Buffer {
  const body = Buffer.from(`${name}\0${value}\0`);
  return pgMessage("S", body);
}

function backendKeyData(pid: number, secret: number): Buffer {
  const body = Buffer.alloc(8);
  body.writeInt32BE(pid, 0);
  body.writeInt32BE(secret, 4);
  return pgMessage("K", body);
}

function readyForQuery(status: string = "I"): Buffer {
  const body = Buffer.from(status, "ascii"); // I=idle
  return pgMessage("Z", body);
}

const postgresqlHandshake: HandshakeModule = {
  name: "postgresql",
  async handle(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.removeListener("data", onData);
        reject(new Error("PostgreSQL handshake timeout"));
      }, 5000);

      function onData(data: Buffer) {
        // Check for StartupMessage: first 4 bytes are length, next 4 are protocol version
        if (data.length < 8) return;

        const protocol = data.readInt32BE(4);
        // Protocol 3.0 = 196608, SSL request = 80877103
        if (protocol === 80877103) {
          // SSL request — respond with 'N' (no SSL)
          socket.write(Buffer.from("N"));
          return;
        }

        if (protocol === 196608) {
          const response = Buffer.concat([
            authOk(),
            parameterStatus("server_version", "15.0"),
            parameterStatus("client_encoding", "UTF8"),
            parameterStatus("DateStyle", "ISO, MDY"),
            backendKeyData(Math.floor(Math.random() * 10000), Math.floor(Math.random() * 10000)),
            readyForQuery(),
          ]);
          socket.write(response);
          clearTimeout(timeout);
          socket.removeListener("data", onData);
          resolve();
        }
      }

      socket.on("data", onData);
    });
  },
};

registerHandshake(postgresqlHandshake);
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/tcp.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/interfaces/handshakes/postgresql.ts tests/tcp.test.ts
git commit -m "feat: PostgreSQL wire protocol handshake module"
```

---

### Task 7: Integration into ProbesInstance and MCP Server

**Files:**
- Modify: `src/lib.ts`
- Modify: `src/server.ts`
- Modify: `tests/lib.test.ts`

- [ ] **Step 1: Add tcp to ProbesInstanceImpl in lib.ts**

Add import at top of `src/lib.ts`:

```ts
import { createTcpInterface, type TcpActions } from "./interfaces/tcp";
```

Add property to `ProbesInstanceImpl`:

```ts
  private tcpImpl?: TcpActions & { close: () => void };
```

In `init()`, add after `fs` initialization:

```ts
    if (this.config.tcp) {
      this.tcpImpl = createTcpInterface(this.config.tcp);
    }
```

Update the "at least one" check:

```ts
    if (!this.sqlImpl && !this.httpImpl && !this.fsImpl && !this.tcpImpl) {
      throw new Error("At least one interface must be configured (http, sql, fs, or tcp)");
    }
```

Add `tcp` getter after the `fs` getter:

```ts
  get tcp(): ProbesInstance["tcp"] {
    if (!this.tcpImpl) throw new Error("TCP interface not configured");
    return {
      send: (p) => this.tcpImpl!.send(p),
      watch: (p) => this.tcpImpl!.watch(p),
    };
  }
```

In `configure()`, add after `fs` partial handling:

```ts
    if (partial.tcp) {
      this.tcpImpl?.close();
      this.tcpImpl = createTcpInterface(validated.tcp!);
    }
```

In `close()`, add:

```ts
    this.tcpImpl?.close();
```

- [ ] **Step 2: Add MCP tools to server.ts**

Add import at top of `src/server.ts`:

```ts
import type { CapturedTcpData } from "./interfaces/types.js";
```

Add two new tool registrations after `fs_reset`, before `const transport = new StdioServerTransport()`:

```ts
  server.registerTool(
    "tcp_send",
    {
      description:
        "Send base64-encoded bytes to all connected clients on a TCP target. Target name must match a configured tcp target.",
      inputSchema: {
        target: z.string().describe("TCP target name from config"),
        data: z.string().describe("Base64-encoded bytes to send"),
      },
    },
    async ({ target, data }) => {
      await instance.tcp.send({ target, data });
      return {
        content: [{ type: "text" as const, text: `Sent ${Buffer.from(data, "base64").length} bytes to ${target}` }],
      };
    }
  );

  server.registerTool(
    "tcp_watch",
    {
      description:
        "Wait for incoming data on a TCP target. Blocks until data arrives or timeout. Returns one chunk of base64-encoded data.",
      inputSchema: {
        target: z.string().describe("TCP target name from config"),
        timeout_ms: z.number().optional().describe("Timeout in milliseconds (default 30000)"),
      },
    },
    async ({ target, timeout_ms }) => {
      const iter = instance.tcp.watch({ target, timeout_ms });
      const result = await iter[Symbol.asyncIterator]().next();
      if (result.done) {
        return {
          content: [{ type: "text" as const, text: "Watch ended" }],
        };
      }
      const captured: CapturedTcpData = result.value;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(captured, null, 2) }],
      };
    }
  );
```

- [ ] **Step 3: Add lib integration test**

Add to `tests/lib.test.ts`:

```ts
import { createConnection } from "node:net";
```

```ts
  it("creates instance with tcp only", async () => {
    const p = track(
      await probes({
        tcp: [{ name: "test_tcp", port: 29877 }],
      })
    );

    const watchIter = p.tcp.watch({ target: "test_tcp", timeout_ms: 3000 });
    const watchPromise = watchIter[Symbol.asyncIterator]().next();

    await new Promise<void>((resolve) => {
      const client = createConnection({ port: 29877, host: "127.0.0.1" }, () => {
        client.write(Buffer.from("lib test"));
        setTimeout(() => client.destroy(), 200);
        resolve();
      });
    });

    const result = await watchPromise;
    expect(Buffer.from(result.value.data, "base64").toString()).toBe("lib test");
  });
```

- [ ] **Step 4: Run all tests**

Run: `bun test`
Expected: All tests PASS across all test files.

- [ ] **Step 5: Commit**

```bash
git add src/lib.ts src/server.ts tests/lib.test.ts
git commit -m "feat: integrate TCP interface into ProbesInstance and MCP server"
```

---

### Task 8: Update Config Error Message and README

**Files:**
- Modify: `src/lib.ts`
- Modify: `README.md`

- [ ] **Step 1: Update README to document TCP interface**

Add TCP section to README after the FS section. In the Hello World example, add TCP usage:

```ts
// TCP — start a raw TCP server, capture incoming bytes, send responses
const p = await probes({
  tcp: [{ name: "my_service", port: 5000, handshake: "raw" }],
});

// Watch for incoming data (AsyncIterable)
for await (const chunk of p.tcp.watch({ target: "my_service" })) {
  console.log(Buffer.from(chunk.data, "base64").toString());
}

// Send bytes to connected client(s)
await p.tcp.send({
  target: "my_service",
  data: Buffer.from("hello").toString("base64"),
});
```

Add TCP config example to the Config section:

```yaml
tcp:
  - name: mongo_mock
    port: 27017
    handshake: mongodb      # auto-responds to ismaster/hello
  - name: redis_mock
    port: 6379
    handshake: redis         # auto-responds to PING/AUTH
  - name: raw_tcp
    port: 9000              # no handshake, raw bytes
```

Add TCP API table:

```markdown
### TCP

| Method | Description |
|--------|-------------|
| `tcp.send({ target, data })` | Send base64-encoded bytes to all connected clients |
| `tcp.watch({ target, timeout_ms? })` | AsyncIterable yielding incoming data chunks |

**Handshake modules:** `raw` (default), `mongodb`, `redis`, `postgresql`
```

Update keywords in the API section to mention TCP.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS — no type errors.

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md src/lib.ts
git commit -m "docs: add TCP interface to README"
```

---

## Post-Implementation Verification

After all tasks complete:

1. `bun test` — all tests pass
2. `bun run typecheck` — no type errors
3. `grep -r "TODO\|TBD\|FIXME" src/interfaces/tcp.ts src/interfaces/handshakes/` — no placeholders
4. Manual smoke test: start MCP server with TCP config, connect a client, verify watch/send work
