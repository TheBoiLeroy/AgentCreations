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
    expect((await db.execute("select id from schema_migrations")).rows.map((r) => r.id)).toEqual(["0001_core"]);
    await expect(
      db.execute("insert into sessions (token_hash, user_id, expires_at) values ('x', 'missing', '2099')"),
    ).rejects.toThrow(/FOREIGN KEY/);
    db.close();
    // Reopening keeps the data and doesn't reapply anything.
    const again = await openDatabase(url);
    expect((await again.execute("select count(*) as n from schema_migrations")).rows[0].n).toBe(1);
    again.close();
  });
});
