import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
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
  it("creates table and inserts rows", async () => {
    const sql = makeSql();
    await sql.put({
      table: "users",
      rows: [{ id: 1, name: "Alice", email: "a@b.com" }],
    });

    const rows = await sql.read({ table: "users" });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Alice");
    expect(rows[0].email).toBe("a@b.com");
  });

  it("replaces existing table data", async () => {
    const sql = makeSql();
    await sql.put({
      table: "users",
      rows: [{ id: 1, name: "Alice" }],
    });
    await sql.put({
      table: "users",
      rows: [
        { id: 2, name: "Bob" },
        { id: 3, name: "Carol" },
      ],
    });

    const rows = await sql.read({ table: "users" });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name).sort()).toEqual(["Bob", "Carol"]);
  });

  it("drops table when rows is empty", async () => {
    const sql = makeSql();
    await sql.put({
      table: "users",
      rows: [{ id: 1, name: "Alice" }],
    });
    await sql.put({ table: "users", rows: [] });

    const rows = await sql.read({ table: "users" });
    expect(rows).toEqual([]);
  });

  it("handles multiple tables independently", async () => {
    const sql = makeSql();
    await sql.put({
      table: "users",
      rows: [{ id: 1, name: "Alice" }],
    });
    await sql.put({
      table: "posts",
      rows: [{ id: 1, title: "Hello", user_id: 1 }],
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
    });

    const rows = await sql.read({ table: "users", limit: 2 });
    expect(rows).toHaveLength(2);
  });
});

describe("sql.reset", () => {
  it("drops specific table", async () => {
    const sql = makeSql();
    await sql.put({
      table: "users",
      rows: [{ id: 1, name: "Alice" }],
    });
    await sql.put({
      table: "posts",
      rows: [{ id: 1, title: "Hello" }],
    });

    await sql.reset({ table: "users" });

    const users = await sql.read({ table: "users" });
    const posts = await sql.read({ table: "posts" });
    expect(users).toEqual([]);
    expect(posts).toHaveLength(1);
  });

  it("drops all tables when no table specified", async () => {
    const sql = makeSql();
    await sql.put({
      table: "users",
      rows: [{ id: 1, name: "Alice" }],
    });
    await sql.put({
      table: "posts",
      rows: [{ id: 1, title: "Hello" }],
    });

    await sql.reset();

    const users = await sql.read({ table: "users" });
    const posts = await sql.read({ table: "posts" });
    expect(users).toEqual([]);
    expect(posts).toEqual([]);
  });
});
