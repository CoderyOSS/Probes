import { Database } from "bun:sqlite";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
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

const EVENTS_TABLE = "_probes_events";

function _getColumns(db: Database, table: string): string[] {
  const info = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
  return info.map((c) => c.name);
}

function _getPrimaryKeys(db: Database, table: string): string[] {
  const info = db.prepare(`PRAGMA table_info("${table}")`).all() as {
    name: string;
    pk: number;
  }[];
  return info
    .filter((c) => c.pk > 0)
    .map((c) => c.name);
}

function _buildJsonObjectExpr(columns: string[], prefix: string): string {
  const parts = columns.map((c) => `'${c}', ${prefix}."${c}"`);
  return `json_object(${parts.join(", ")})`;
}

function _buildRowIdExpr(pks: string[], prefix: string): string {
  if (pks.length === 0) return `CAST(${prefix}.rowid AS TEXT)`;
  return pks
    .map((pk) => `CAST(${prefix}."${pk}" AS TEXT)`)
    .join(` || '|' || `);
}

function _createEventTable(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${EVENTS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    operation TEXT NOT NULL,
    row_id TEXT,
    event_time TEXT NOT NULL,
    data TEXT
  )`);
}

function _safeTriggerName(table: string): string {
  return table.replace(/[^a-zA-Z0-9_]/g, "_");
}

function _createTriggersForTable(db: Database, table: string): void {
  const columns = _getColumns(db, table);
  if (columns.length === 0) return;

  const pks = _getPrimaryKeys(db, table);
  const safe = _safeTriggerName(table);

  const newDataObj = _buildJsonObjectExpr(columns, "NEW");
  const oldDataObj = _buildJsonObjectExpr(columns, "OLD");
  const newRowId = _buildRowIdExpr(pks, "NEW");
  const oldRowId = _buildRowIdExpr(pks, "OLD");

  db.exec(`DROP TRIGGER IF EXISTS _probes_${safe}_ai`);
  db.exec(`DROP TRIGGER IF EXISTS _probes_${safe}_au`);
  db.exec(`DROP TRIGGER IF EXISTS _probes_${safe}_ad`);

  db.exec(
    `CREATE TRIGGER _probes_${safe}_ai AFTER INSERT ON "${table}" BEGIN
      INSERT INTO ${EVENTS_TABLE}(table_name, operation, row_id, event_time, data)
      VALUES ('${table}', 'INSERT', ${newRowId}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ${newDataObj});
    END`,
  );

  db.exec(
    `CREATE TRIGGER _probes_${safe}_au AFTER UPDATE ON "${table}" BEGIN
      INSERT INTO ${EVENTS_TABLE}(table_name, operation, row_id, event_time, data)
      VALUES ('${table}', 'UPDATE', ${newRowId}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ${newDataObj});
    END`,
  );

  db.exec(
    `CREATE TRIGGER _probes_${safe}_ad AFTER DELETE ON "${table}" BEGIN
      INSERT INTO ${EVENTS_TABLE}(table_name, operation, row_id, event_time, data)
      VALUES ('${table}', 'DELETE', ${oldRowId}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ${oldDataObj});
    END`,
  );
}

function _ensureAllTriggers(db: Database, tracked: Set<string>): void {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_probes_%'",
    )
    .all() as { name: string }[];

  for (const { name } of tables) {
    if (tracked.has(name)) continue;
    _createTriggersForTable(db, name);
    tracked.add(name);
  }
}

function _flushEvents(db: Database, record?: RecordBuffer): void {
  const events = db
    .prepare(
      `SELECT table_name, operation, row_id, event_time, data FROM ${EVENTS_TABLE} ORDER BY id`,
    )
    .all() as {
    table_name: string;
    operation: string;
    row_id: string | null;
    event_time: string;
    data: string | null;
  }[];

  if (events.length === 0) return;

  for (const evt of events) {
    record?.push({
      kind: "recv",
      time: evt.event_time,
      source: `sql:${evt.table_name}`,
      data: evt.data ? JSON.parse(evt.data) : null,
    });
  }

  db.exec(`DELETE FROM ${EVENTS_TABLE}`);
}

export function createSqlInterface(
  config: SqlConfig,
  record?: RecordBuffer,
): SqlActions {
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
  db.exec("PRAGMA busy_timeout = 5000");

  const _seededTables = new Set<string>();
  const _triggeredTables = new Set<string>();

  _createEventTable(db);
  _ensureAllTriggers(db, _triggeredTables);

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
          _triggeredTables.delete(table);
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
              if (typeof v === "object" && v !== null) return JSON.stringify(v);
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

      db.exec(`DELETE FROM ${EVENTS_TABLE}`);
      _ensureAllTriggers(db, _triggeredTables);
    },

    async read({ table, where, order_by, limit }) {
      _ensureAllTriggers(db, _triggeredTables);
      _flushEvents(db, record);

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

      db.exec(`DELETE FROM ${EVENTS_TABLE}`);
    },

    close() {
      db.close();
    },
  };
}
