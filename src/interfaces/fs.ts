import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  watch,
  statSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import type { FsConfig } from "./types";

export interface FsActions {
  put: (params: { path: string; content: string }) => Promise<void>;
  read: (params: { path: string }) => Promise<string>;
  watch: (params: { path: string; timeout_ms?: number }) => Promise<string>;
  reset: (params?: { path?: string }) => Promise<void>;
  close: () => void;
}

function safePath(root: string, relativePath: string): string {
  const normalized = resolve(root, relativePath);
  if (!normalized.startsWith(root)) {
    throw new Error(`Path traversal not allowed: ${relativePath}`);
  }
  return normalized;
}

export function createFsInterface(config: FsConfig): FsActions {
  const root = resolve(config.root);

  if (config.reset_on_start && existsSync(root)) {
    rmSync(root, { recursive: true, force: true });
  }

  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }

  return {
    async put({ path, content }) {
      const fullPath = safePath(root, path);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, "utf8");
    },

    async read({ path }) {
      const fullPath = safePath(root, path);
      if (!existsSync(fullPath)) {
        throw new Error(`File not found: ${path}`);
      }
      return readFileSync(fullPath, "utf8");
    },

    async watch({ path, timeout_ms = 5000 }) {
      const fullPath = safePath(root, path);
      const initialContent = existsSync(fullPath)
        ? readFileSync(fullPath, "utf8")
        : null;

      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          watcher.close();
          reject(new Error(`Watch timeout: ${path} did not change within ${timeout_ms}ms`));
        }, timeout_ms);

        const dir = dirname(fullPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        const watcher = watch(dir, (eventType, filename) => {
          if (filename !== path.split("/").pop() && filename !== path.split("\\").pop()) return;

          const current = existsSync(fullPath)
            ? readFileSync(fullPath, "utf8")
            : null;

          if (current !== initialContent) {
            clearTimeout(timer);
            watcher.close();
            resolve(current ?? "");
          }
        });

        watcher.on("error", (err) => {
          clearTimeout(timer);
          watcher.close();
          reject(err);
        });
      });
    },

    async reset(params) {
      if (params?.path) {
        const fullPath = safePath(root, params.path);
        if (existsSync(fullPath)) {
          const st = statSync(fullPath);
          if (st.isDirectory()) {
            rmSync(fullPath, { recursive: true, force: true });
          } else {
            rmSync(fullPath, { force: true });
          }
        }
      } else {
        if (existsSync(root)) {
          rmSync(root, { recursive: true, force: true });
        }
        mkdirSync(root, { recursive: true });
      }
    },

    close() {},
  };
}
