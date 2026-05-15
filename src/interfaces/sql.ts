import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SqlConfig } from "./types";
import type { RecordBuffer } from "./record";

export interface SqlActions {
  put: (params: any) => Promise<void>;
  read: (params: {
    table: string;
    where?: Record<string, unknown>;
    order_by?: string;
    limit?: number;
  }) => Promise<Record<string, unknown>[]>;
  clear: (params?: { table?: string; all?: boolean }) => Promise<void>;
  close: () => void;
}

function inferColumnType(value: unknown): string {
  if (value === null || value === undefined) return "TEXT";
  if (typeof value === "boolean") return "INTEGER";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "INTEGER" : "REAL";
  }
  return "TEXT";
}

function extractTable(sql: string): string {
  const s = sql.trim().toUpperCase();
  let m: RegExpMatchArray | null;
  if (s.startsWith("SELECT")) {
    m = sql.match(/FROM\s+"?(\w+)"?/i);
  } else if (s.startsWith("INSERT")) {
    m = sql.match(/INTO\s+"?(\w+)"?/i);
  } else if (s.startsWith("UPDATE")) {
    m = sql.match(/UPDATE\s+"?(\w+)"?/i);
  } else if (s.startsWith("DELETE")) {
    m = sql.match(/FROM\s+"?(\w+)"?/i);
  } else {
    return "unknown";
  }
  return m ? m[1].toLowerCase() : "unknown";
}

export function createSqlInterface(
  config: SqlConfig,
  record?: RecordBuffer,
): SqlActions {
  const dbPath = resolve(config.path);
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");

  if (config.schema_file) {
    const schemaPath = resolve(config.schema_file);
    const schemaSql = readFileSync(schemaPath, "utf8");
    db.exec(schemaSql);
  }

  let server: ReturnType<typeof Bun.serve> | null = null;

  if ((config as any).server_port) {
    server = Bun.serve({
      port: (config as any).server_port,
      async fetch(req) {
        try {
          const body = (await req.json()) as {
            sql: string;
            params?: any[];
            type?: string;
          };
          const { sql, params = [], type } = body;
          const time = new Date().toISOString();
          const firstWord = sql.trim().toUpperCase().split(/\s+/)[0];

          if (
            type === "batch" ||
            firstWord === "CREATE" ||
            firstWord === "DROP" ||
            firstWord === "PRAGMA" ||
            firstWord === "ALTER"
          ) {
            db.exec(sql);
            return Response.json({ ok: true });
          }

          const table = extractTable(sql);

          if (firstWord === "SELECT") {
            const stmt = db.prepare(sql);
            const rows = params.length > 0 ? stmt.all(...params) : stmt.all();
            record?.push({
              kind: "recv",
              time,
              source: `sql:${table}`,
              data: rows,
            });
            return Response.json({ rows });
          } else {
            const stmt = db.prepare(sql);
            const info =
              params.length > 0 ? stmt.run(...params) : stmt.run();
            record?.push({
              kind: "recv",
              time,
              source: `sql:${table}`,
              data: {
                sql: sql.trim().slice(0, 200),
                changes: info.changes,
              },
            });
            return Response.json({
              changes: info.changes,
              last_insert_rowid: info.lastInsertRowid ?? null,
            });
          }
        } catch (err: any) {
          return Response.json({ error: err.message }, { status: 500 });
        }
      },
    });
  }

  const _seededTables = new Set<string>();

  return {
    async put(params: any) {
      let tables: Record<string, Record<string, unknown>[]> = {};

      if (params.file) {
        if (params.table || params.rows) {
          throw new Error("Use 'file' or 'table' with 'rows', not both");
        }
        const resolvedPath = resolve(params.file);
        const raw = readFileSync(resolvedPath, "utf8");
        tables = parseYaml(raw) as Record<string, Record<string, unknown>[]>;
      } else if (params.table && Array.isArray(params.rows)) {
        tables[params.table] = params.rows;
      } else {
        throw new Error("Provide 'file' or 'table' with 'rows'");
      }

      const force = params.force_schema === true;

      for (const [table, rows] of Object.entries(tables)) {
        if (!Array.isArray(rows) || rows.length === 0) continue;

        const exists = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(table);

        if (!exists && !force) {
          throw new Error(
            `Table '${table}' does not exist. Use { force_schema: true } to create it.`,
          );
        }

        if (force) {
          db.exec(`DROP TABLE IF EXISTS "${table}"`);
          const first = rows[0];
          const columns = Object.keys(first);
          const colDefs = columns.map((col) => {
            const val = first[col];
            const type = inferColumnType(val);
            const nullable = val === null ? "" : " NOT NULL";
            return `"${col}" ${type}${nullable}`;
          });
          db.exec(`CREATE TABLE "${table}" (${colDefs.join(", ")})`);
        }

        const firstRow = rows[0];
        const columns = Object.keys(firstRow);
        const placeholders = columns.map(() => "?").join(", ");
        const sql = `INSERT OR REPLACE INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`;
        const insert = db.prepare(sql);
        const insertAll = db.transaction((rs: Record<string, unknown>[]) => {
          for (const row of rs) {
            const values = columns.map((col) => {
              const v = row[col];
              if (typeof v === "boolean") return v ? 1 : 0;
              if (typeof v === "object" && v !== null)
                return JSON.stringify(v);
              return v ?? null;
            });
            insert.run(...(values as [string]));
          }
        });
        insertAll(rows);
        _seededTables.add(table);
        record?.push({
          kind: "send",
          time: new Date().toISOString(),
          interface: "sql",
          action: "put",
          path: table,
          data: `${rows.length} rows`,
        });
      }
    },

    async read({ table, where, order_by, limit }) {
      const tableCheck = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        )
        .get(table) as { name: string } | undefined;
      if (!tableCheck) return [];

      let sql = `SELECT * FROM "${table}"`;
      const params: unknown[] = [];

      if (where && Object.keys(where).length > 0) {
        const clauses = Object.entries(where).map(([col, val]) => {
          params.push(val);
          return `"${col}" = ?`;
        });
        sql += ` WHERE ${clauses.join(" AND ")}`;
      }

      if (order_by) {
        sql += ` ORDER BY "${order_by}"`;
      }

      if (limit) {
        sql += ` LIMIT ${limit}`;
      }

      const rows = db.prepare(sql).all(...(params as [string])) as Record<
        string,
        unknown
      >[];
      return rows;
    },

    async clear(params?: { table?: string; all?: boolean }) {
      if (params?.table) {
        db.exec(`DELETE FROM "${params.table}"`);
        _seededTables.delete(params.table);
        record?.push({
          kind: "send",
          time: new Date().toISOString(),
          interface: "sql",
          action: "clear",
          data: `table: ${params.table}`,
        });
      } else if (params?.all) {
        const tables = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          )
          .all() as { name: string }[];
        for (const t of tables) {
          db.exec(`DELETE FROM "${t.name}"`);
        }
        _seededTables.clear();
        record?.push({
          kind: "send",
          time: new Date().toISOString(),
          interface: "sql",
          action: "clear",
          data: "all tables",
        });
      } else {
        for (const table of _seededTables) {
          db.exec(`DELETE FROM "${table}"`);
        }
        _seededTables.clear();
        record?.push({
          kind: "send",
          time: new Date().toISOString(),
          interface: "sql",
          action: "clear",
          data: "seeded tables",
        });
      }
    },

    close() {
      server?.stop();
      db.close();
    },
  };
}
