# TCP Socket Interface Design

**Date:** 2026-05-01
**Status:** Draft
**Scope:** Add generic TCP socket interface to @codery/probes

## Problem

Probes currently supports HTTP, SQL (SQLite), and filesystem interfaces. Applications under test often communicate with services over raw TCP — MongoDB, Redis, PostgreSQL, custom protocols. Probes needs a way to intercept these connections so tests can observe what the app sends and control what it receives, without requiring protocol-specific implementations for every service.

## Design Decisions

### Why TCP socket (not protocol mocks, not module interception)

Three approaches were evaluated:

1. **Module-level interception** (like Sinon) — hooks into `import`/`require` to inject mocks. Language-specific (JS only). Rejected: Probes must be language-agnostic.

2. **Protocol-aware mock servers** — speak MongoDB wire protocol, PostgreSQL wire protocol, etc. Provides semantic API (`mongo.put({ collection, documents })`) but requires implementing each protocol. MongoDB wire protocol alone has 30+ operation types, BSON encoding, compression, auth negotiation. Rejected: too much implementation per protocol.

3. **Generic TCP socket interface** — listens on a port, captures raw bytes, sends raw bytes on command. Any client in any language connects via TCP. User handles protocol semantics in their tests. **Selected.**

### Implementation language

TypeScript first (in current Bun codebase). Prove the design, ship it, then port to Rust core later when language bindings are needed. Rust migration is a separate design.

### Mock-only (no proxy mode)

Initial implementation is mock-only: Probes runs a TCP server, captures incoming bytes, sends bytes when the user triggers `send()`. No forwarding to a real backend. Proxy mode (forward to real instance + capture) is deferred to a follow-up design.

## Interface

### Configuration

Multiple named TCP targets, each binding a localhost port:

```yaml
tcp:
  - name: mongo_mock
    port: 27017
    handshake: mongodb
    idle_timeout_ms: 30000
  - name: redis_mock
    port: 6379
    handshake: redis
  - name: raw_service
    port: 9000
```

Fields:
- `name` (required, string) — unique identifier used in API calls
- `port` (required, integer 1-65535) — localhost port to bind
- `handshake` (optional, string) — name of handshake module to use. Defaults to `"raw"` (no handshake)
- `idle_timeout_ms` (optional, integer) — close connections idle longer than this

Validation: names must be unique, ports must not conflict across targets.

### API

Two operations on the TCP interface:

```ts
// Send bytes to all connected clients on the named target
tcp.send({ target: string, data: string }): Promise<void>
// data is base64-encoded

// Stream incoming data on the named target. Returns AsyncIterable.
tcp.watch({ target: string, timeout_ms?: number }): AsyncIterable<CapturedTcpData>
// Yields: { data: string (base64), timestamp: number, remote: string }
```

No `read()`, `put()`, or `reset()` — TCP is not a storage interface. Data is observed in real-time via `watch()` and injected in real-time via `send()`.

**Library API (TS):** `watch()` returns `AsyncIterable<CapturedTcpData>`:

```ts
for await (const chunk of p.tcp.watch({ target: "mongo_mock" })) {
  console.log(chunk.data); // base64 bytes
}
```

Stream ends when target is closed or loop is broken.

**MCP tool:** `tcp_watch` blocks, returns one chunk per call. Caller invokes repeatedly to consume the stream. The MCP server calls the iterator's `.next()` once per tool invocation.

### MCP Tools

```
tcp_send   — { target: string, data: string (base64) }
tcp_watch  — { target: string, timeout_ms?: number } → returns one chunk per call
```

## Handshake Modules

Clients expect protocol-specific handshakes on connection. A MongoDB client sends an `ismaster` command and waits for a BSON response — if it gets silence, it times out. Probes cannot rely on the user calling `send()` fast enough.

### Solution: pluggable handshake modules

A handshake module handles the initial protocol negotiation automatically when a client connects. After the handshake completes, the connection enters normal mode where `watch()` and `send()` operate.

### Built-in handshake modules

| Module name | Protocol | What it does |
|-------------|----------|--------------|
| `raw` | None (default) | No handshake. Connection accepted, bytes pass through immediately. |
| `mongodb` | MongoDB wire protocol | Responds to `ismaster`/`hello` with a valid BSON response indicating a standalone mongod. Handles `saslStart`/`saslContinue` for auth bypass. |
| `redis` | RESP | Responds to `PING` with `+PONG`, handles `AUTH` (no-op success), `CLIENT` commands. |
| `postgresql` | PostgreSQL wire protocol | Responds to startup message with `AuthenticationOk`, `ParameterStatus`, `BackendKeyData`, `ReadyForQuery`. |

### Custom handshake modules

Users can provide their own handshake logic. A handshake module is a TS file exporting:

```ts
interface HandshakeModule {
  name: string;
  handle(socket: Duplex): Promise<void>;
}
```

Config can reference custom modules by file path:

```yaml
tcp:
  - name: custom_service
    port: 5000
    handshake: "./handshakes/my-protocol.ts"
```

### Handshake resolution order

1. Built-in name match (`"mongodb"`, `"redis"`, `"postgresql"`, `"raw"`)
2. File path (`.ts` or `.js` file relative to config)
3. Error if not found

## Connection Lifecycle

```
Client connects
  → handshake module runs (if configured)
  → connection enters normal mode

Client sends data
  → watch() yields { data, timestamp, remote }
  → if no active consumer, data is buffered (single-entry, latest wins)

User calls send({ target, data })
  → bytes written to all connected sockets on that target

Idle timeout expires
  → connection closed, removed from active list
```

### Buffering

One single-entry buffer per target. If data arrives and no `watch()` consumer is active, the latest chunk is held. Next `watch()` iteration returns immediately with the buffered data. If a second chunk arrives before the first is consumed, the first is overwritten. This matches the real-time observation model — if you're not watching, you miss data.

## Data Encoding

All binary data in the API is base64-encoded. MCP tool parameters are JSON strings, and TCP payloads are arbitrary bytes. Base64 is the universal encoding.

Utility helpers provided: `tcp.encode(data: Uint8Array): string` and `tcp.decode(base64: string): Uint8Array`.

## Types

```ts
interface TcpTargetConfig {
  name: string;
  port: number;
  handshake?: string;
  idle_timeout_ms?: number;
}

interface TcpConfig {
  tcp: TcpTargetConfig[];
}

interface CapturedTcpData {
  data: string;    // base64-encoded bytes
  timestamp: number;
  remote: string;  // "host:port" of client
}

interface TcpActions {
  send(params: { target: string; data: string }): Promise<void>;
  watch(params: { target: string; timeout_ms?: number }): AsyncIterable<CapturedTcpData>;
  close(): void;
}
```

## File Structure

```
src/
  interfaces/
    tcp.ts              — createTcpInterface(), TcpActions
    types.ts            — add TcpTargetConfig, TcpConfig, CapturedTcpData
    handshakes/
      index.ts          — handshake registry and resolver
      raw.ts            — no-op handshake
      mongodb.ts        — MongoDB ismaster/hello response
      redis.ts          — RESP PONG/auth bypass
      postgresql.ts     — AuthenticationOk cycle
  config.ts             — add TcpSchema to zod validation
  lib.ts                — add tcp to ProbesInstance
  server.ts             — register tcp_send, tcp_watch MCP tools
  utils/
    state.ts            — extend for single-entry TCP buffer
```

## Integration with ProbesInstance

```ts
const p = await probes({
  tcp: [
    { name: "mongo_mock", port: 27017, handshake: "mongodb" },
  ],
});

// Stream incoming data
for await (const chunk of p.tcp.watch({ target: "mongo_mock" })) {
  console.log(chunk); // { data: "...", timestamp: ..., remote: "..." }
}

// Send bytes to connected client(s)
await p.tcp.send({ target: "mongo_mock", data: b64EncodedResponse });

await p.close();
```

The `tcp` property on `ProbesInstance` is indexed by `target` name. `configure()` accepts partial TCP config, hot-swaps listeners. `close()` shuts down all TCP servers.

## Testing Strategy

- Unit tests for each handshake module (connect, verify handshake bytes exchanged)
- Integration test: real MongoDB client connects to Probes TCP server with `handshake: mongodb`, sends a find command, test captures it via `watch()`, sends a response via `send()`
- Integration test: raw TCP target with no handshake, generic client
- Test idle timeout closes stale connections
- Test multiple targets on different ports simultaneously
- Test data encoding round-trip (Uint8Array → base64 → Uint8Array)
- Test AsyncIterable watch — verify chunks stream correctly over multiple sends

## Future Work (out of scope)

- **UDP datagram interface** — same `send()`/`watch()` model, connectionless. No handshakes. For DNS, SNMP, syslog, QUIC-based protocols, game servers.
- **Proxy mode** — forward to real backend while capturing traffic
- **Rust core implementation** — port TCP interface to Rust for language bindings
- **Connection-level routing** — send to specific client instead of broadcast
- **TLS support** — wrap connections in TLS for protocols that require it
- **Protocol helper libraries** — optional higher-level APIs for common protocols (e.g., `mongodb-helper` that encodes BSON responses from structured data)
