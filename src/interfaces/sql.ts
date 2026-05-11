import { Database } from "bun:sqlite";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SqlConfig } from "./types";
import type { RecordBuffer } from "./record";

export interface SqlActions {
  put: (params: {
    table: string;
    rows: Record<string, unknown>[];
  }) => Promise<void>;
  read: (params: {
    table: string;
    where?: Record<string, unknown>;
    order_by?: string;
    limit?: number;
  }) => Promise<Record<string, unknown>[]>;
  reset: (params?: { table?: string }) => Promise<void>;
  fixture: (path: string) => Promise<void>;
  unfixture: () => Promise<void>;
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

export function createSqlInterface(config: SqlConfig, record?: RecordBuffer): SqlActions {
  const dbPath = resolve(config.path);
  mkdirSync(dirname(dbPath), { recursive: true });

  if (config.reset_on_start && existsSync(dbPath)) {
    const tmp = new Database(dbPath);
    const tables = tmp
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    for (const t of tables) {
      tmp.exec(`DROP TABLE IF EXISTS "${t.name}"`);
    }
    tmp.close();
  }

  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");

  let _fixtureTables: string[] = [];

  return {
    async put({ table, rows }) {
      db.exec(`DROP TABLE IF EXISTS "${table}"`);

      if (rows.length === 0) return;

      const first = rows[0];
      const columns = Object.keys(first);
      const colDefs = columns.map((col) => {
        const val = first[col];
        const type = inferColumnType(val);
        const nullable = val === null ? "" : " NOT NULL";
        return `"${col}" ${type}${nullable}`;
      });
      const createSql = `CREATE TABLE "${table}" (${colDefs.join(", ")})`;
      db.exec(createSql);

      const placeholders = columns.map(() => "?").join(", ");
      const insertSql = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`;
      const insert = db.prepare(insertSql);

      const insertMany = db.transaction((rows: Record<string, unknown>[]) => {
        for (const row of rows) {
          const values = columns.map((col) => {
            const v = row[col];
            if (typeof v === "boolean") return v ? 1 : 0;
            if (typeof v === "object" && v !== null) return JSON.stringify(v);
            return v ?? null;
          });
          insert.run(...values as [string]);
        }
      });

      insertMany(rows);
    },

    async read({ table, where, order_by, limit }) {
      const tableCheck = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table) as { name: string } | undefined;
      if (!tableCheck) {
        record?.push({
          kind: "recv",
          time: new Date().toISOString(),
          source: `sql:${table}`,
          data: [],
        });
        return [];
      }

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

      const rows = db.prepare(sql).all(...params as [string]) as Record<string, unknown>[];
      record?.push({
        kind: "recv",
        time: new Date().toISOString(),
        source: `sql:${table}`,
        data: rows,
      });
      return rows;
    },

    async reset(params) {
      if (params?.table) {
        db.exec(`DROP TABLE IF EXISTS "${params.table}"`);
      } else {
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
          .all() as { name: string }[];
        for (const t of tables) {
          db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
        }
      }
    },

    close() {
      db.close();
    },

    async fixture(path: string) {
      const resolvedPath = resolve(path);
      const raw = readFileSync(resolvedPath, "utf8");
      const data = parseYaml(raw) as Record<string, Record<string, unknown>[]>;
      for (const [table, rows] of Object.entries(data)) {
        if (Array.isArray(rows)) {
          await this.put({ table, rows });
          if (!_fixtureTables.includes(table)) {
            _fixtureTables.push(table);
          }
        }
      }
    },

    async unfixture() {
      for (const table of _fixtureTables) {
        db.exec(`DROP TABLE IF EXISTS "${table}"`);
      }
      _fixtureTables = [];
    },
  };
}
