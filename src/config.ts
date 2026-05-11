import { readFileSync, existsSync } from "node:fs";
import { extname, resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { ProbesConfig } from "./interfaces/types";

const HttpClientSchema = z.object({
  base_url: z.string().url(),
  headers: z.record(z.string()).optional(),
  timeout_ms: z.number().int().positive().optional(),
});

const HttpServerSchema = z.object({
  port: z.number().int().min(1).max(65535),
  idle_timeout_ms: z.number().int().positive().optional(),
});

const HttpSchema = z.object({
  client: HttpClientSchema.optional(),
  server: HttpServerSchema.optional(),
});

const SqlSchema = z.object({
  path: z
    .string()
    .min(1)
    .refine((p) => !p.includes(".."), "Path traversal not allowed"),
  reset_on_start: z.boolean().optional(),
});

const FsSchema = z.object({
  root: z
    .string()
    .min(1)
    .refine((p) => !p.includes(".."), "Path traversal not allowed"),
  reset_on_start: z.boolean().optional(),
});

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

const WsServerTargetSchema = z.object({
  name: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  idle_timeout_ms: z.number().int().positive().optional(),
});

const WsServerSchema = z.array(WsServerTargetSchema).min(1).refine(
  (targets) => {
    const names = targets.map((t) => t.name);
    return new Set(names).size === names.length;
  },
  { message: "WS server target names must be unique" }
);

const WsClientTargetSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
});

const WsClientSchema = z.array(WsClientTargetSchema).min(1).refine(
  (targets) => {
    const names = targets.map((t) => t.name);
    return new Set(names).size === names.length;
  },
  { message: "WS client target names must be unique" }
);

const WsSchema = z.object({
  client: WsClientSchema.optional(),
  server: WsServerSchema.optional(),
});

const UnixClientSchema = z.object({
  path: z.string().min(1),
  timeout_ms: z.number().int().positive().optional(),
});

const UnixServerTargetSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  idle_timeout_ms: z.number().int().positive().optional(),
});

const UnixServerSchema = z.array(UnixServerTargetSchema).min(1).refine(
  (targets) => {
    const names = targets.map((t) => t.name);
    return new Set(names).size === names.length;
  },
  { message: "Unix server target names must be unique" }
);

const UnixSchema = z.object({
  client: UnixClientSchema.optional(),
  server: UnixServerSchema.optional(),
});

const RecordSchema = z.object({
  output_path: z.string().min(1),
  title: z.string().optional(),
});

const ProbesConfigSchema = z
  .object({
    http: HttpSchema.optional(),
    sql: SqlSchema.optional(),
    fs: FsSchema.optional(),
    tcp: TcpSchema.optional(),
    ws: WsSchema.optional(),
    unix: UnixSchema.optional(),
    record: RecordSchema.optional(),
  })
  .strict();

export function loadConfig(filePath: string): ProbesConfig {
  const ext = extname(filePath).toLowerCase();
  if (ext !== ".yml" && ext !== ".yaml" && ext !== ".json") {
    throw new Error(
      `Unsupported config file extension: ${ext}. Use .yml, .yaml, or .json`
    );
  }

  const raw = readFileSync(filePath, "utf8");
  const parsed = ext === ".json" ? JSON.parse(raw) : parseYaml(raw);
  return validateConfig(parsed);
}

export function validateConfig(input: unknown): ProbesConfig {
  return ProbesConfigSchema.parse(input) as ProbesConfig;
}

export function findConfigFile(startDir: string): string | null {
  const names = ["probes.yml", "probes.yaml", "probes.json"];
  let dir = resolve(startDir);

  for (let i = 0; i < 20; i++) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}
