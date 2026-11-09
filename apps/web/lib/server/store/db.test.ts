import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrate, openDatabase } from "./db";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
describe("local Turso storage", () => {
  it("creates the file and its folder, applies migrations once and enforces foreign keys", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-creations-db-"));
    dirs.push(dir);
    const url = `file:${join(dir, "nested", "test.db")}`;
    const db = await openDatabase(url);
    await migrate(db);
    expect((await db.execute("select id from schema_migrations")).rows.map((r) => r.id)).toEqual(["0001_core", "0002_setups_60_items"]);
    await expect(
      db.execute("insert into sessions (token_hash, user_id, expires_at) values ('x', 'missing', '2099')"),
    ).rejects.toThrow(/FOREIGN KEY/);
    db.close();
    // Reopening keeps the data and doesn't reapply anything.
    const again = await openDatabase(url);
    expect((await again.execute("select count(*) as n from schema_migrations")).rows[0].n).toBe(2);
    again.close();
  });
});
describe("0002 setups rebuild", () => {
  it("keeps existing setups when upgrading a 0001 database", async () => {
    const { createClient } = await import("@libsql/client");
    const { migrations } = await import("./migrations");
    const db = createClient({ url: ":memory:" });
    await db.execute("pragma foreign_keys = on");
    await db.execute("create table schema_migrations (id text primary key, applied_at text)");
    for (const statement of migrations[0].sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await db.execute(statement);
    await db.execute("insert into schema_migrations (id) values ('0001_core')");
    await db.execute("insert into users (id, kind, github_id) values ('u', 'github', 1)");
    await db.execute("insert into profiles values ('u', 'ian', 'Ian', null)");
    await db.execute(`insert into setups (id, user_id, slug, title, items, item_count, published) values ('s', 'u', 'a', 'A', '[{"kind":"skill"}]', 1, 1)`);
    await migrate(db);
    expect((await db.execute("select id, slug, item_count, published from setups")).rows).toEqual([expect.objectContaining({ id: "s", slug: "a", item_count: 1, published: 1 })]);
    expect((await db.execute("select name from sqlite_master where name = 'setups_recent'")).rows).toHaveLength(1);
    db.close();
  });
});
describe("database location", () => {
  it("never falls back to a local file on Vercel", async () => {
    const { databaseUrl } = await import("./db");
    const saved = { url: process.env.TURSO_DATABASE_URL, vercel: process.env.VERCEL };
    try {
      delete process.env.TURSO_DATABASE_URL;
      process.env.VERCEL = "1";
      expect(() => databaseUrl()).toThrow("TURSO_DATABASE_URL is not set");
      process.env.TURSO_DATABASE_URL = "libsql://db-org.turso.io";
      expect(databaseUrl()).toBe("libsql://db-org.turso.io");
      delete process.env.VERCEL;
      delete process.env.TURSO_DATABASE_URL;
      expect(databaseUrl()).toMatch(/^file:.*\.data\/agent-creations\.db$/);
    } finally {
      if (saved.url === undefined) delete process.env.TURSO_DATABASE_URL;
      else process.env.TURSO_DATABASE_URL = saved.url;
      if (saved.vercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = saved.vercel;
    }
  });
});
