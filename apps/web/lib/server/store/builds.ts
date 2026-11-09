import { randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import { isUniqueViolation, json, now, one, rows, writeTransaction } from "./db";

export class StoreConflict extends Error {}
export interface BuildRow {
  id: string;
  user_id: string;
  trigger: string | null;
  draft: unknown;
  spec: unknown;
  revision: number;
  updated_at: string;
}
type Raw = Omit<BuildRow, "draft" | "spec"> & { draft: string; spec: string | null };
const parse = (row: Raw): BuildRow => ({ ...row, draft: json(row.draft), spec: row.spec === null ? null : json(row.spec) });
const columns = `id, user_id, "trigger", draft, spec, revision, updated_at`;
export async function listBuilds(db: Client, userId: string) {
  return (await rows<Raw>(db, `select ${columns} from agent_builds where user_id = ? order by updated_at desc limit 100`, [userId])).map(parse);
}
export async function getBuild(db: Client, userId: string, id: string) {
  const row = await one<Raw>(db, `select ${columns} from agent_builds where id = ? and user_id = ?`, [id, userId]);
  return row && parse(row);
}
/**
 * Saves a draft at the expected revision and allocates a unique trigger per user.
 * Stale revisions fail with StoreConflict instead of overwriting.
 */
export async function saveBuild(
  db: Client,
  userId: string,
  input: { id: string; draft: { name?: string }; base: string | null; expectedRevision: number; spec: Record<string, unknown> | null },
): Promise<BuildRow> {
  try {
    return await writeTransaction(db, async (tx) => {
      const existing = await one<Raw>(tx, `select ${columns} from agent_builds where id = ?`, [input.id]);
      // Another user's id is treated like a missing row: no information leaks, no write happens.
      if (existing && existing.user_id !== userId) throw new StoreConflict("Build unavailable");
      if ((existing ? existing.revision : 0) !== input.expectedRevision) throw new StoreConflict("Draft changed elsewhere");
      let trigger = input.base;
      if (existing && json<{ name?: string }>(existing.draft).name === input.draft.name) trigger = existing.trigger;
      else if (input.base) {
        for (let suffix = 2; ; suffix++) {
          const taken = await one(tx, `select 1 from agent_builds where user_id = ? and "trigger" = ? and id <> ?`, [userId, trigger, input.id]);
          if (!taken) break;
          trigger = `${input.base.slice(0, 64 - `-${suffix}`.length).replace(/-$/, "")}-${suffix}`;
        }
      }
      const spec = input.spec && trigger ? { ...input.spec, trigger, slug: trigger } : input.spec;
      if (input.spec && !trigger) throw new Error("Name required");
      const draft = JSON.stringify(input.draft);
      if (existing)
        await tx.execute({
          sql: `update agent_builds set "trigger" = ?, draft = ?, spec = ?, revision = revision + 1, updated_at = ? where id = ? and user_id = ?`,
          args: [trigger, draft, spec && JSON.stringify(spec), now(), input.id, userId],
        });
      else
        await tx.execute({
          sql: `insert into agent_builds (id, user_id, "trigger", draft, spec, revision, updated_at) values (?, ?, ?, ?, ?, 1, ?)`,
          args: [input.id, userId, trigger, draft, spec && JSON.stringify(spec), now()],
        });
      return parse((await one<Raw>(tx, `select ${columns} from agent_builds where id = ?`, [input.id]))!);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new StoreConflict("Trigger taken concurrently");
    throw error;
  }
}
export async function addSkillRequest(db: Client, userId: string, term: string) {
  await db.execute({
    sql: "insert into skill_requests (user_id, search_term) values (?, ?) on conflict do nothing",
    args: [userId, term],
  });
}
export const newId = () => randomUUID();
