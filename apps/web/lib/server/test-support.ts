// Route tests run against a real in-memory libSQL database and a fake cookie jar.
import type { Client } from "@libsql/client";
import { openDatabase, useDatabase } from "./store/db";

export const jar = new Map<string, string>();
export const cookieStore = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  set: (name: string, value: string) => void jar.set(name, value),
  delete: (name: string) => void jar.delete(name),
  getAll: () => [...jar].map(([name, value]) => ({ name, value })),
};
export async function freshDatabase(): Promise<Client> {
  jar.clear();
  const db = await openDatabase(":memory:");
  useDatabase(db);
  return db;
}
export const post = (path: string, body: unknown, init: RequestInit = {}) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    ...init,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
