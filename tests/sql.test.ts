import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createSqlInterface } from "../src/interfaces/sql";
import type { SqlConfig } from "../src/interfaces/types";

const DB_DIR = join(import.meta.dir, "__tmp_sql_test__");
const DB_PATH = join(DB_DIR, "test.db");

beforeEach(() => mkdirSync(DB_DIR, { recursive: true }));
afterEach(() => {
  rmSync(DB_DIR, { recursive: true, force: true });
});

function makeSql(config?: Partial<SqlConfig>) {
  return createSqlInterface({
    path: DB_PATH,
    reset_on_start: false,
    ...config,
  });
}

describe("sql.put", () => {
  it("creates table and inserts rows with force_schema", async () => {
    const sql = makeSql();
    await sql.put({
      table: "users",
      rows: [{ id: 1, name: "Alice", email: "a@b.com" }],
      force_schema: true,
    });

    const rows = await sql.read({ table: "users" });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Alice");
    expect(rows[0].email).toBe("a@b.com");
  });

  it("inserts into existing table without force_schema", async () => {
    const sql = makeSql();
    await sql.put({
      table: "users",
      rows: [{ id: 1, name: "Alice" }],
      force_schema: true,
    });

    await sql.put({
      table: "users",
      rows: [{ id: 2, name: "Bob" }],
    });

    const rows = await sql.read({ table: "users" });
    expect(rows).toHaveLength(2);
  });

  it("replaces table data when force_schema used repeatedly", async () => {
    const sql = makeSql();
    await sql.put({
      table: "users",
      rows: [{ id: 1, name: "Alice" }],
      force_schema: true,
    });
    await sql.put({
      table: "users",
      rows: [
        { id: 2, name: "Bob" },
        { id: 3, name: "Carol" },
      ],
      force_schema: true,
    });

    const rows = await sql.read({ table: "users" });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name).sort()).toEqual(["Bob", "Carol"]);
  });

  it("throws on missing table without force_schema", async () => {
    const sql = makeSql();
    expect(
      sql.put({ table: "ghost", rows: [{ id: 1 }] })
    ).rejects.toThrow("does not exist");
  });

  it("loads fixture from file with force_schema", async () => {
    const sql = makeSql();
    writeFileSync(
      join(DB_DIR, "fixture.yaml"),
      "users:\n  - { id: 1, name: Alice }\nposts:\n  - { id: 1, title: Hello, user_id: 1 }\n",
    );

    await sql.put({ file: join(DB_DIR, "fixture.yaml"), force_schema: true });

    const users = await sql.read({ table: "users" });
    expect(users).toHaveLength(1);
    const posts = await sql.read({ table: "posts" });
    expect(posts).toHaveLength(1);
  });

  it("loads fixture from file into existing table without force_schema", async () => {
    const sql = makeSql();
    await sql.put({ table: "users", rows: [{ id: 1, name: "Alice" }], force_schema: true });
    writeFileSync(
      join(DB_DIR, "fixture.yaml"),
      "users:\n  - { id: 2, name: Bob }\n",
    );

    await sql.put({ file: join(DB_DIR, "fixture.yaml") });

    const users = await sql.read({ table: "users" });
    expect(users).toHaveLength(2);
  });

  it("throws when both file and table/rows provided", async () => {
    const sql = makeSql();
    expect(
      sql.put({ file: "x.yaml", table: "users", rows: [] } as any)
    ).rejects.toThrow("not both");
  });

  it("throws when neither file nor table/rows provided", async () => {
    const sql = makeSql();
    expect(
      sql.put({} as any)
    ).rejects.toThrow("Provide 'file' or 'table' with 'rows'");
  });

  it("handles multiple tables independently", async () => {
    const sql = makeSql();
    await sql.put({
      table: "users",
      rows: [{ id: 1, name: "Alice" }],
      force_schema: true,
    });
    await sql.put({
      table: "posts",
      rows: [{ id: 1, title: "Hello", user_id: 1 }],
      force_schema: true,
    });

    const users = await sql.read({ table: "users" });
    const posts = await sql.read({ table: "posts" });
    expect(users).toHaveLength(1);
    expect(posts).toHaveLength(1);
  });
});

describe("sql.read", () => {
  it("reads with where filter", async () => {
    const sql = makeSql();
    await sql.put({
      table: "users",
      rows: [
        { id: 1, name: "Alice", active: 1 },
        { id: 2, name: "Bob", active: 0 },
      ],
      force_schema: true,
    });

    const active = await sql.read({ table: "users", where: { active: 1 } });
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe("Alice");
  });

  it("reads with order_by", async () => {
    const sql = makeSql();
    await sql.put({
      table: "users",
      rows: [
        { id: 3, name: "Carol" },
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
      force_schema: true,
    });

    const rows = await sql.read({ table: "users", order_by: "name" });
    expect(rows.map((r) => r.name)).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("reads with limit", async () => {
    const sql = makeSql();
    await sql.put({
      table: "users",
      rows: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Carol" },
      ],
      force_schema: true,
    });

    const rows = await sql.read({ table: "users", limit: 2 });
    expect(rows).toHaveLength(2);
  });
});

describe("sql.clear", () => {
  it("clears specific table", async () => {
    const sql = makeSql();
    await sql.put({ table: "users", rows: [{ id: 1, name: "Alice" }], force_schema: true });
    await sql.put({ table: "posts", rows: [{ id: 1, title: "Hello" }], force_schema: true });

    await sql.clear({ table: "users" });

    const users = await sql.read({ table: "users" });
    const posts = await sql.read({ table: "posts" });
    expect(users).toEqual([]);
    expect(posts).toHaveLength(1);
  });

  it("clears all tables", async () => {
    const sql = makeSql();
    await sql.put({ table: "users", rows: [{ id: 1, name: "Alice" }], force_schema: true });
    await sql.put({ table: "posts", rows: [{ id: 1, title: "Hello" }], force_schema: true });

    await sql.clear({ all: true });

    const users = await sql.read({ table: "users" });
    const posts = await sql.read({ table: "posts" });
    expect(users).toEqual([]);
    expect(posts).toEqual([]);
  });

  it("clears seeded tables by default", async () => {
    const sql = makeSql();
    await sql.put({ table: "users", rows: [{ id: 1, name: "Alice" }], force_schema: true });

    await sql.clear();

    const users = await sql.read({ table: "users" });
    expect(users).toEqual([]);
  });

  it("read returns data after put, empty after clear", async () => {
    const sql = makeSql();
    await sql.put({ table: "items", rows: [{ id: 1, name: "widget" }], force_schema: true });

    const afterPut = await sql.read({ table: "items" });
    expect(afterPut).toHaveLength(1);

    await sql.clear();
    const afterClear = await sql.read({ table: "items" });
    expect(afterClear).toEqual([]);
  });
});
