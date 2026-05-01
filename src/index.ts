#!/usr/bin/env bun
import { resolve } from "node:path";
import { loadConfig, findConfigFile } from "./config.js";
import { startMcpServer } from "./server.js";

async function main() {
  const args = process.argv.slice(2);
  let configPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) {
      configPath = args[i + 1];
      break;
    }
  }

  if (!configPath) {
    const found = findConfigFile(process.cwd());
    if (!found) {
      console.error(
        "No probes.yml or probes.json found. Create one or use --config <path>."
      );
      process.exit(1);
    }
    configPath = found;
  }

  const config = loadConfig(resolve(configPath));
  await startMcpServer(config);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
