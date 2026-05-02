# @codery/probes

MCP server and library for E2E continuous testing — HTTP, SQL, filesystem, and TCP socket probes.

## Install

```bash
bun add @codery/probes
```

## Hello World

```ts
import { probes } from "@codery/probes";

const p = await probes({
  http: {
    server: { port: 9876 },
  },
  sql: { path: "./data/test.db", reset_on_start: true },
  fs: { root: "./test-fixture", reset_on_start: true },
});

// HTTP — stage a response, then capture incoming requests
await p.http.put({ status: 200, body: { message: "hello" } });
const res = await p.http.send({ method: "GET", path: "/" });
console.log(res.status); // 200

// SQL — seed a table and read it back
await p.sql.put({ table: "users", rows: [{ id: 1, name: "Alice" }] });
const users = await p.sql.read({ table: "users" });
console.log(users); // [{ id: 1, name: "Alice" }]

// FS — write and read files
await p.fs.put({ path: "greeting.txt", content: "hello world" });
const content = await p.fs.read({ path: "greeting.txt" });
console.log(content); // "hello world"

// TCP — raw socket server, capture and send bytes
const p2 = await probes({
  tcp: [{ name: "my_service", port: 5000 }],
});
// Watch streams incoming data (AsyncIterable)
for await (const chunk of p2.tcp.watch({ target: "my_service" })) {
  console.log(Buffer.from(chunk.data, "base64").toString());
}
// Send bytes to connected clients
await p2.tcp.send({ target: "my_service", data: Buffer.from("hello").toString("base64") });

await p.close();
await p2.close();
```

## MCP Server

Run as an MCP server with a config file:

```bash
bunx probes --config probes.yml
```

### Config (`probes.yml`)

```yaml
http:
  client:
    base_url: "http://localhost:3000"
    timeout_ms: 5000
  server:
    port: 9876
    idle_timeout_ms: 30000

sql:
  path: "./data/test.db"
  reset_on_start: true

fs:
  root: "./test-fixture"
  reset_on_start: true

tcp:
  - name: mongo_mock
    port: 27017
    handshake: mongodb
  - name: redis_mock
    port: 6379
    handshake: redis
  - name: raw_tcp
    port: 9000
```

## API

### `probes(config) → ProbesInstance`

Creates and initializes a probes instance. At least one interface must be configured.

### HTTP

| Method | Description |
|--------|-------------|
| `http.send({ method, path, headers?, body? })` | Send request to configured `base_url` |
| `http.put({ status, headers?, body? })` | Stage a response for the mock server |
| `http.read()` | Drain captured requests |
| `http.watch({ timeout_ms? })` | Wait for next incoming request |
| `http.reset()` | Clear captured requests and staged response |

### SQL

| Method | Description |
|--------|-------------|
| `sql.put({ table, rows })` | Create table and insert rows (drops existing) |
| `sql.read({ table, where?, order_by?, limit? })` | Query rows |
| `sql.reset({ table? })` | Drop table (or all tables) |

### FS

| Method | Description |
|--------|-------------|
| `fs.put({ path, content })` | Write file |
| `fs.read({ path })` | Read file |
| `fs.watch({ path, timeout_ms? })` | Wait for file change |
| `fs.reset({ path? })` | Delete file/dir (or clear root) |

### TCP

| Method | Description |
|--------|-------------|
| `tcp.send({ target, data })` | Send base64-encoded bytes to all connected clients |
| `tcp.watch({ target, timeout_ms? })` | AsyncIterable yielding incoming data chunks |

**Handshake modules:** `raw` (default), `mongodb`, `redis`, `postgresql`

Handshake modules auto-handle initial protocol negotiation (e.g., MongoDB `ismaster`, Redis `PING`). After handshake, `watch()` and `send()` operate on raw bytes.

## License

MIT
