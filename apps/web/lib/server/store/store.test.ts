// The ownership, conflict and publication rules that row-level security and RPCs used to enforce,
// run against a real libSQL engine.
import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { openDatabase } from "./db";
import { createSession, createUser, deleteSession, githubUser, sessionUser, type User } from "./users";
import { addSkillRequest, getBuild, listBuilds, saveBuild, StoreConflict } from "./builds";
import { createSetup, deleteSetup, HandleTaken, mySetups, publishedSetup, publishedSetups, publishedSkillSources, updateSetup, upsertProfile } from "./setups";
import { curate, indexedSkills, isMaintainer, publishedRun, stagePage, startSync } from "./catalog";

let db: Client;
let ian: User, sam: User, guest: User;
const id1 = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  id2 = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
beforeEach(async () => {
  db = await openDatabase(":memory:");
  ian = await createUser(db, "github", 1);
  sam = await createUser(db, "github", 2);
  guest = await createUser(db, "anonymous");
});
const save = (user: User, id: string, expectedRevision: number, name = "Quote Writer", spec: Record<string, unknown> | null = null) =>
  saveBuild(db, user.id, { id, draft: { name }, base: "quote-writer", expectedRevision, spec });
const setup = (slug = "daily-driver", published = true) => ({
  title: "Daily driver",
  slug,
  description: "",
  items: [{ kind: "skill" as const, repository: "anthropics/skills", skill: "pdf", note: "" }],
  published,
});

describe("sessions", () => {
  it("stores only a hash, expires, and signs out", async () => {
    const { token } = await createSession(db, ian.id);
    expect((await db.execute("select token_hash from sessions")).rows[0].token_hash).not.toBe(token);
    expect((await sessionUser(db, token))?.id).toBe(ian.id);
    expect(await sessionUser(db, "forged")).toBeUndefined();
    await db.execute("update sessions set expires_at = '2000-01-01'");
    expect(await sessionUser(db, token)).toBeUndefined();
    const second = await createSession(db, ian.id);
    await deleteSession(db, second.token);
    expect(await sessionUser(db, second.token)).toBeUndefined();
  });
  it("upgrades an anonymous visitor in place on GitHub sign-in and reuses known accounts", async () => {
    await save(guest, id1, 0);
    const upgraded = await githubUser(db, guest, { id: 99, login: "new", name: null, avatar_url: null });
    expect(upgraded).toEqual({ id: guest.id, kind: "github", github_id: 99 });
    expect((await listBuilds(db, guest.id)).map((b) => b.id)).toEqual([id1]);
    expect((await githubUser(db, undefined, { id: 1, login: "x", name: null, avatar_url: null })).id).toBe(ian.id);
    expect((await githubUser(db, ian, { id: 3, login: "y", name: null, avatar_url: null })).id).not.toBe(ian.id);
  });
});
describe("agent drafts", () => {
  it("allocates per-user unique triggers and keeps an allocation when the name is unchanged", async () => {
    expect((await save(ian, id1, 0)).trigger).toBe("quote-writer");
    expect((await save(ian, id2, 0)).trigger).toBe("quote-writer-2");
    expect((await save(ian, id2, 1)).trigger).toBe("quote-writer-2");
    // Different users can use the same trigger.
    expect((await save(sam, "cccccccc-cccc-4ccc-cccc-cccccccccccc", 0)).trigger).toBe("quote-writer");
  });
  it("rejects stale revisions and writes the allocated trigger into the spec", async () => {
    await save(ian, id1, 0);
    await expect(save(ian, id1, 0)).rejects.toBeInstanceOf(StoreConflict);
    await expect(save(ian, id1, 5)).rejects.toBeInstanceOf(StoreConflict);
    await save(ian, id2, 0);
    const done = await save(ian, id2, 1, "Quote Writer", { name: "Quote Writer", trigger: "quote-writer", slug: "quote-writer" });
    expect(done.spec).toMatchObject({ trigger: "quote-writer-2", slug: "quote-writer-2" });
    expect(done.revision).toBe(2);
  });
  it("never reads or writes another user's draft", async () => {
    await save(ian, id1, 0);
    expect(await getBuild(db, sam.id, id1)).toBeUndefined();
    expect(await listBuilds(db, sam.id)).toEqual([]);
    await expect(save(sam, id1, 1, "Hijack")).rejects.toBeInstanceOf(StoreConflict);
    expect((await getBuild(db, ian.id, id1))?.draft).toEqual({ name: "Quote Writer" });
  });
  it("counts one skill request per user and term", async () => {
    await addSkillRequest(db, ian.id, "calendar sync");
    await addSkillRequest(db, ian.id, "calendar sync");
    await addSkillRequest(db, sam.id, "calendar sync");
    await expect(addSkillRequest(db, ian.id, " UPPER ")).rejects.toThrow();
    expect((await db.execute("select search_term, count(*) as votes from skill_requests group by 1")).rows).toEqual([
      expect.objectContaining({ search_term: "calendar sync", votes: 2 }),
    ]);
  });
});
describe("profiles and setups", () => {
  it("lets only profile owners publish, and never shows private drafts", async () => {
    await expect(createSetup(db, guest.id, setup())).rejects.toThrow(/FOREIGN KEY/);
    await upsertProfile(db, ian.id, { login: "ElianCoder", name: "Ian", avatar_url: "https://evil.example/a.png" });
    expect((await mySetups(db, ian.id)).length).toBe(0);
    const saved = await createSetup(db, ian.id, setup());
    expect(saved).toMatchObject({ revision: 1, item_count: 1, published: true, profiles: { handle: "eliancoder", avatar_url: null } });
    await createSetup(db, ian.id, setup("private-notes", false));
    await expect(createSetup(db, ian.id, setup())).rejects.toBeInstanceOf(StoreConflict);
    expect((await publishedSetups(db, "eliancoder")).map((s) => s.slug)).toEqual(["daily-driver"]);
    expect(await publishedSetup(db, "eliancoder", "private-notes")).toBeUndefined();
    expect((await publishedSetup(db, "eliancoder", "daily-driver"))?.items).toEqual(setup().items);
  });
  it("blocks edits by anyone else and stale writes", async () => {
    await upsertProfile(db, ian.id, { login: "ian", name: null, avatar_url: null });
    await upsertProfile(db, sam.id, { login: "sam", name: null, avatar_url: null });
    const saved = await createSetup(db, ian.id, setup());
    await expect(updateSetup(db, sam.id, saved.id, { ...setup(), title: "Hijacked" }, 1)).rejects.toBeInstanceOf(StoreConflict);
    expect(await deleteSetup(db, sam.id, saved.id)).toBe(false);
    expect((await updateSetup(db, ian.id, saved.id, { ...setup(), title: "Renamed" }, 1)).revision).toBe(2);
    await expect(updateSetup(db, ian.id, saved.id, setup(), 1)).rejects.toBeInstanceOf(StoreConflict);
    await expect(upsertProfile(db, sam.id, { login: "IAN", name: null, avatar_url: null })).rejects.toBeInstanceOf(HandleTaken);
  });
  it("rejects malformed items at the database too", async () => {
    await upsertProfile(db, ian.id, { login: "ian", name: null, avatar_url: null });
    for (const items of [[], "nope", ["x".repeat(65000)]])
      await expect(createSetup(db, ian.id, { ...setup(), items } as never)).rejects.toThrow(/constraint|JSON/i);
  });
  it("finds the repositories people publish a skill name from", async () => {
    await upsertProfile(db, ian.id, { login: "ian", name: null, avatar_url: null });
    await createSetup(db, ian.id, { ...setup(), items: [{ kind: "skill", repository: "mattpocock/skills", skill: "grill-me", note: "" }] });
    await createSetup(db, ian.id, { ...setup("hidden", false), items: [{ kind: "skill", repository: "someone/else", skill: "grill-me", note: "" }] });
    expect(await publishedSkillSources(db, ["grill-me"])).toEqual([expect.objectContaining({ repository: "mattpocock/skills", uses: 1 })]);
  });
});
describe("catalog", () => {
  const entries = (n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => ({ id: `owner/repo/s${from + i}`, source: "owner/repo", slug: `s${from + i}`, sourceType: "github", installs: i }));
  it("requires a signed-in maintainer", async () => {
    expect(await isMaintainer(db, ian)).toBe(false);
    await db.execute({ sql: "insert into catalog_maintainers values (?)", args: [ian.id] });
    await db.execute({ sql: "insert into catalog_maintainers values (?)", args: [guest.id] });
    expect(await isMaintainer(db, ian)).toBe(true);
    expect(await isMaintainer(db, guest)).toBe(false);
  });
  it("publishes only after the last page, atomically, and keeps the old one on failures", async () => {
    const first = await startSync(db, ian.id);
    await stagePage(db, ian.id, { runId: first.id, page: 0, total: 501, more: true, entries: entries(500) });
    expect(await publishedRun(db)).toBeUndefined();
    await expect(stagePage(db, ian.id, { runId: first.id, page: 0, total: 501, more: false, entries: entries(1, 500) })).rejects.toBeInstanceOf(StoreConflict);
    await expect(stagePage(db, ian.id, { runId: first.id, page: 1, total: 502, more: false, entries: entries(1, 500) })).rejects.toThrow("Invalid catalog page");
    await expect(stagePage(db, ian.id, { runId: first.id, page: 1, total: 501, more: false, entries: entries(1, 0) })).rejects.toBeInstanceOf(StoreConflict);
    expect((await stagePage(db, ian.id, { runId: first.id, page: 1, total: 501, more: false, entries: entries(1, 500) })).status).toBe("published");
    expect((await publishedRun(db))?.id).toBe(first.id);
    expect(await indexedSkills(db, ["s3"])).toEqual([{ name: "s3", repository: "owner/repo", installs: 3 }]);
    const older = await startSync(db, ian.id);
    const newer = await startSync(db, ian.id);
    await stagePage(db, ian.id, { runId: newer.id, page: 0, total: 1, more: false, entries: entries(1) });
    await expect(stagePage(db, ian.id, { runId: older.id, page: 0, total: 1, more: false, entries: entries(1) })).rejects.toThrow("Newer catalog");
    expect((await publishedRun(db))?.id).toBe(newer.id);
  });
  it("curates with revisions and an audit trail", async () => {
    const change = { target: "anthropics/skills/pdf", decision: "flagged" as const, reason: "Review", requirements: { shell: true }, revision: 0 };
    expect((await curate(db, ian.id, change)).revision).toBe(1);
    await expect(curate(db, ian.id, change)).rejects.toBeInstanceOf(StoreConflict);
    await curate(db, ian.id, { ...change, decision: "approved-source", revision: 1 });
    const trail = (await db.execute("select action, before_value from catalog_audit where action = 'curate' order by id")).rows;
    expect(trail.map((r) => r.before_value === null)).toEqual([true, false]);
  });
});
