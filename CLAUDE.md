# CoderyProbes — LLM Agent Guide

## What This Is

E2E testing framework for black-box systems. Provides HTTP, SQL, filesystem, TCP, WebSocket probes that record interaction events into proof records (markdown).

## Exports

| Export | Purpose | Auto-init? | Auto-save? |
|--------|---------|-----------|------------|
| `p` | Global lazy proxy | Yes (top-level await) | Yes (exit/beforeExit hooks) |
| `probes()` | Factory function | No | No — must call `.proof.save()` manually |
| `probesSession()` | Manual init with config | No | Yes (exit/beforeExit hooks) |
| `group()` | Shared instance pool | No | No |

## Which Export to Use

**Use `p` in test suites.** Auto-init walks up from CWD to find `probes.yml`. Registers `process.on("exit")` and `process.on("beforeExit")` to auto-save proof records.

**Do NOT use `probes()` factory in test suites.** It creates an isolated instance without auto-save. Proof records will NOT be generated unless you explicitly call `.proof.save()`.

## bun test + Proof Records

`bun test` does NOT fire `process.on("exit")` handlers. The `p` export also registers `process.on("beforeExit")` as a fallback. For extra safety, add a preload file:

```toml
# bunfig.toml
[test]
preload = ["./setup.ts"]
```

```ts
// setup.ts
import { afterAll } from "bun:test";
import { p } from "@codery/probes";
afterAll(() => p.proof.save());
```

## Interfaces

Tests access probes via `p.http`, `p.sql`, `p.fs`, `p.tcp`, `p.wsServer`, `p.wsClient`, `p.unix`, `p.proof`.

- `p.http.send(opts)` — HTTP request with automatic response recording
- `p.sql.query(sql)` / `p.sql.run(sql)` — SQLite queries via drizzle
- `p.fs.read(path)` / `p.fs.write(path, content)` / `p.fs.exists(path)` — Filesystem probes
- `p.proof.begin(section)` / `p.proof.end()` — Group proof events into sections
- `p.proof.save()` — Write accumulated events to markdown file

## Config (probes.yml)

```yaml
proof:
  title: "My E2E Suite"
  output: "proof-records.md"

interfaces:
  http:
    base_url: "http://localhost:4050"
  sql:
    path: "/path/to/db.sqlite"

launcher:
  command: "cargo run -- daemon"
  ready_after_ms: 2000
```

## File Structure

```
src/
├── lib.ts              # Exports: p, probes(), probesSession(), group()
├── config.ts           # YAML loading + validation
├── interfaces/
│   ├── types.ts        # ProbesConfig, ProbesInstance, RecordEvent types
│   ├── record.ts       # Proof record generation (save → markdown)
│   ├── http.ts         # HTTP probe (send, use adapter)
│   ├── sql.ts          # SQLite probe (query, run)
│   ├── fs.ts           # Filesystem probe (read, write, exists)
│   ├── tcp.ts          # TCP probe (connect, send, recv)
│   ├── ws_server.ts    # WebSocket server probe
│   ├── ws_client.ts    # WebSocket client probe
│   └── unix.ts         # Unix socket probe
tests/
└── record.test.ts      # Proof record tests (uses probes() factory + manual save)
```

## Code Style

- No `unwrap()` outside tests (this is TypeScript — use `?` and null checks)
- No comments unless asked
- No emoji
- Follow existing patterns in neighboring files
