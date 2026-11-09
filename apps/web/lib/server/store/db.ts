import { createClient, type Client, type InArgs, type Row, type Transaction } from "@libsql/client";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrations } from "./migrations";

export type Db = Client | Transaction;
/** The repository root, found from the working directory (apps/web under Next, the root under tests). */
function repoRoot() {
  let dir = process.cwd();
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
  return dir;
}
/** Local Turso storage by default; TURSO_DATABASE_URL points at a Turso Cloud database instead. */
export function databaseUrl() {
  return process.env.TURSO_DATABASE_URL || `file:${join(repoRoot(), ".data", "agent-creations.db")}`;
}
export async function migrate(db: Client) {
  await db.execute(
    "create table if not exists schema_migrations (id text primary key, applied_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))",
  );
  const applied = new Set((await db.execute("select id from schema_migrations")).rows.map((row) => String(row.id)));
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    // One transaction per migration: a failure leaves the database at the previous version.
    const tx = await db.transaction("write");
    try {
      for (const statement of split(migration.sql)) await tx.execute(statement);
      await tx.execute({ sql: "insert into schema_migrations (id) values (?)", args: [migration.id] });
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
  }
}
/** Splits on semicolons that end a line. The schema has no triggers or string literals containing ";\n". */
const split = (sql: string) =>
  sql
    .split(/;\s*\n/)
    .map((statement) => statement.trim())
    .filter(Boolean);
export async function openDatabase(url = databaseUrl(), authToken = process.env.TURSO_AUTH_TOKEN) {
  if (url.startsWith("file:")) mkdirSync(dirname(resolve(fileURLToPath(new URL(url.replace(/^file:(?!\/\/)/, "file://"))))), { recursive: true });
  const db = createClient({ url, authToken: authToken || undefined });
  if (url.startsWith("file:")) {
    // Concurrent dev requests wait for each other instead of failing with "database is locked".
    await db.execute("pragma busy_timeout = 5000");
    await db.execute("pragma journal_mode = wal");
  }
  await db.execute("pragma foreign_keys = on");
  await migrate(db);
  return db;
}
// One client per server process. Kept on globalThis so dev reloads and separate route bundles share it.
const shared = globalThis as unknown as { agentCreationsDb?: Promise<Client> };
export function database(): Promise<Client> {
  shared.agentCreationsDb ??= openDatabase().catch((error) => {
    shared.agentCreationsDb = undefined;
    throw error;
  });
  return shared.agentCreationsDb;
}
/** Tests swap in an in-memory database. */
export function useDatabase(db: Client | undefined) {
  shared.agentCreationsDb = db ? Promise.resolve(db) : undefined;
}
export async function rows<T = Row>(db: Db, sql: string, args: InArgs = []): Promise<T[]> {
  return (await db.execute({ sql, args })).rows as unknown as T[];
}
export async function one<T = Row>(db: Db, sql: string, args: InArgs = []): Promise<T | undefined> {
  return (await rows<T>(db, sql, args))[0];
}
/** Runs `work` in a write transaction: committed if it returns, rolled back if it throws. */
export async function writeTransaction<T>(db: Client, work: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = await db.transaction("write");
  try {
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
export const isUniqueViolation = (error: unknown) =>
  error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
export const isConstraintViolation = (error: unknown) =>
  error instanceof Error && /constraint failed/i.test(error.message);
export const json = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : (value as T));
export const now = () => new Date().toISOString();
