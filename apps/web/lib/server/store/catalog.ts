// Staged skills.sh catalog: one validated page per request, published atomically on the last page.
// Only maintainers (signed-in, non-anonymous, listed in catalog_maintainers) can write.
import { randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import { isUniqueViolation, json, now, one, rows, writeTransaction, type Db } from "./db";
import { StoreConflict } from "./builds";
import type { User } from "./users";

export class InvalidCatalog extends Error {}
export interface Run {
  id: string;
  status: "staging" | "published" | "superseded";
  next_page: number;
  expected_total: number | null;
  started_at: string;
  published_at: string | null;
}
const runColumns = "id, status, next_page, expected_total, started_at, published_at";
export async function isMaintainer(db: Db, user: User | undefined) {
  return !!user && user.kind !== "anonymous" && !!(await one(db, "select 1 from catalog_maintainers where user_id = ?", [user.id]));
}
export async function publishedRun(db: Client) {
  return one<Run>(db, `select ${runColumns} from catalog_runs where status = 'published'`);
}
export async function recentRuns(db: Client) {
  return rows<Run>(db, `select ${runColumns} from catalog_runs order by started_at desc limit 20`);
}
export async function getRun(db: Client, id: string) {
  return one<Run>(db, `select ${runColumns} from catalog_runs where id = ?`, [id]);
}
const audit = (db: Db, actor: string, action: string, target: string, before: unknown = null, after: unknown = null) =>
  db.execute({
    sql: "insert into catalog_audit (actor, action, target, before_value, after_value) values (?, ?, ?, ?, ?)",
    args: [actor, action, target, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after)],
  });
export async function startSync(db: Client, actor: string) {
  return writeTransaction(db, async (tx) => {
    const id = randomUUID();
    await tx.execute({ sql: "insert into catalog_runs (id, actor, started_at) values (?, ?, ?)", args: [id, actor, now()] });
    await audit(tx, actor, "sync-start", id);
    return (await one<Run>(tx, `select ${runColumns} from catalog_runs where id = ?`, [id]))!;
  });
}
type Entry = { id: string; source: string; slug: string } & Record<string, unknown>;
export async function stagePage(
  db: Client,
  actor: string,
  page: { runId: string; page: number; total: number; more: boolean; entries: Entry[] },
) {
  const { runId, total, more, entries } = page;
  if (!Number.isInteger(total) || total < 1 || total > 100000) throw new InvalidCatalog("Invalid catalog page");
  if (entries.length < 1 || entries.length > 500 || (more && entries.length !== 500)) throw new InvalidCatalog("Incomplete catalog page");
  for (const item of entries)
    if (!item || typeof item.id !== "string" || item.id.length > 500 || item.id !== `${item.source}/${item.slug}`)
      throw new InvalidCatalog("Invalid catalog entry");
  try {
    return await writeTransaction(db, async (tx) => {
      // The write transaction serializes this with other stagers, as the advisory lock did.
      const run = await one<Run>(tx, `select ${runColumns} from catalog_runs where id = ?`, [runId]);
      if (!run || run.status !== "staging" || run.next_page !== page.page) throw new StoreConflict("Sync revision conflict");
      if (run.expected_total !== null && run.expected_total !== total) throw new InvalidCatalog("Invalid catalog page");
      for (const item of entries)
        await tx.execute({ sql: "insert into catalog_entries (run_id, id, metadata) values (?, ?, ?)", args: [runId, item.id, JSON.stringify(item)] });
      const staged = Number((await one<{ n: number }>(tx, "select count(*) as n from catalog_entries where run_id = ?", [runId]))!.n);
      const seen = page.page * 500 + entries.length;
      if (staged !== seen || (more && seen >= total) || (!more && seen !== total)) throw new InvalidCatalog("Catalog count mismatch");
      await tx.execute({ sql: "update catalog_runs set expected_total = ?, next_page = next_page + 1 where id = ?", args: [total, runId] });
      if (!more) {
        if (await one(tx, "select 1 from catalog_runs where status = 'published' and started_at >= ?", [run.started_at]))
          throw new StoreConflict("Newer catalog already published");
        await tx.execute("update catalog_runs set status = 'superseded' where status = 'published'");
        await tx.execute({ sql: "update catalog_runs set status = 'published', published_at = ? where id = ?", args: [now(), runId] });
        await audit(tx, actor, "sync-publish", runId, null, { total });
      }
      return (await one<Run>(tx, `select ${runColumns} from catalog_runs where id = ?`, [runId]))!;
    });
  } catch (error) {
    // A duplicate id within the run aborts the whole page rather than hiding a missing row.
    if (isUniqueViolation(error)) throw new StoreConflict("Duplicate catalog entry");
    throw error;
  }
}
export interface Curation {
  target: string;
  decision: "approved-source" | "excluded" | "flagged" | "unreviewed";
  reason: string;
  requirements: Record<string, boolean>;
  revision: number;
}
export async function curate(db: Client, actor: string, change: Curation) {
  return writeTransaction(db, async (tx) => {
    const previous = await one<Record<string, unknown> & { revision: number; requirements: string }>(
      tx,
      "select target, decision, reason, requirements, revision, actor, updated_at from catalog_overrides where target = ?",
      [change.target],
    );
    if ((previous?.revision ?? 0) !== change.revision) throw new StoreConflict("Curation revision conflict");
    await tx.execute({
      sql: `insert into catalog_overrides (target, decision, reason, requirements, revision, actor, updated_at) values (?, ?, ?, ?, ?, ?, ?)
            on conflict (target) do update set decision = excluded.decision, reason = excluded.reason, requirements = excluded.requirements,
              revision = excluded.revision, actor = excluded.actor, updated_at = excluded.updated_at`,
      args: [change.target, change.decision, change.reason, JSON.stringify(change.requirements), change.revision + 1, actor, now()],
    });
    const result = (await one<Record<string, unknown> & { requirements: string; revision: number }>(
      tx,
      "select target, decision, reason, requirements, revision, actor, updated_at from catalog_overrides where target = ?",
      [change.target],
    ))!;
    const after = { ...result, requirements: json(result.requirements) };
    await audit(tx, actor, "curate", change.target, previous ? { ...previous, requirements: json(previous.requirements) } : null, after);
    return after;
  });
}
/** Skills in the published skills.sh index whose name matches, for resolving bare names on import. */
export async function indexedSkills(db: Client, names: string[]) {
  if (!names.length) return [];
  return rows<{ name: string; repository: string; installs: number }>(
    db,
    `select lower(json_extract(e.metadata, '$.slug')) as name, json_extract(e.metadata, '$.source') as repository,
            coalesce(json_extract(e.metadata, '$.installs'), 0) as installs
     from catalog_entries e join catalog_runs r on r.id = e.run_id
     where r.status = 'published' and json_extract(e.metadata, '$.sourceType') = 'github'
       and lower(json_extract(e.metadata, '$.slug')) in (${names.map(() => "?").join(", ")})
     order by installs desc limit 200`,
    names,
  );
}
