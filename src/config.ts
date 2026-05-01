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

const ProbesConfigSchema = z
  .object({
    http: HttpSchema.optional(),
    sql: SqlSchema.optional(),
    fs: FsSchema.optional(),
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
