import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
let db: PGlite;
const ian = "11111111-1111-4111-8111-111111111111",
  sam = "22222222-2222-4222-8222-222222222222",
  guest = "33333333-3333-4333-8333-333333333333";
const items = JSON.stringify([{ kind: "skill", repository: "anthropics/skills", skill: "pdf", note: "" }]);
const as = (id: string) => db.exec(`set role authenticated; set "request.jwt.claim.sub" = '${id}';`);
const create = (slug: string, published = true) =>
  db.query<{ id: string; revision: number; item_count: number }>(
    "insert into public.setups(slug, title, items, published) values ($1, 'My setup', $2::jsonb, $3) returning *",
    [slug, items, published],
  );
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create table auth.identities(user_id uuid references auth.users(id), provider text, identity_data jsonb, created_at timestamptz default now());
    insert into auth.users values ('${ian}'), ('${sam}'), ('${guest}');
    insert into auth.identities(user_id, provider, identity_data) values
      ('${ian}', 'github', '{"user_name":"ElianCoder","full_name":"Ian","avatar_url":"https://avatars.githubusercontent.com/u/1"}'),
      ('${sam}', 'github', '{"user_name":"sam-dev","avatar_url":"https://evil.example/a.png"}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;`);
  await db.exec(await readFile("supabase/migrations/202611090001_profiles_setups.sql", "utf8"));
}, 30000);
afterAll(async () => {
  await db.close();
});
describe.sequential("profiles and setups (real Postgres engine)", () => {
  it("takes the handle from the GitHub identity and refuses accounts without one", async () => {
    await as(ian);
    const profile = (await db.query("select * from public.claim_profile()")).rows[0];
    expect(profile).toMatchObject({ handle: "eliancoder", display_name: "Ian", avatar_url: "https://avatars.githubusercontent.com/u/1" });
    // Claiming again updates in place rather than failing.
    expect((await db.query("select handle from public.claim_profile()")).rows).toEqual([{ handle: "eliancoder" }]);
    await as(sam);
    expect((await db.query("select * from public.claim_profile()")).rows[0]).toMatchObject({ handle: "sam-dev", display_name: "sam-dev", avatar_url: null });
    await as(guest);
    await expect(db.query("select * from public.claim_profile()")).rejects.toMatchObject({ code: "42501" });
    // No direct writes: a handle cannot be typed in or changed.
    await expect(db.query("insert into public.profiles(user_id, handle, display_name) values ($1, 'eliancoder2', 'x')", [guest])).rejects.toBeDefined();
    await as(ian);
    await expect(db.query("update public.profiles set handle = 'someone-else'")).rejects.toBeDefined();
  });
  it("lets only profile owners publish, and only as themselves", async () => {
    await as(guest);
    await expect(create("guest-setup")).rejects.toBeDefined();
    await as(ian);
    const saved = (await create("daily-driver")).rows[0];
    expect(saved).toMatchObject({ revision: 1, item_count: 1 });
    await create("private-notes", false);
    await expect(create("daily-driver")).rejects.toMatchObject({ code: "23505" });
    await expect(db.query("insert into public.setups(user_id, slug, title, items) values ($1, 'forged', 'x', $2::jsonb)", [sam, items])).rejects.toBeDefined();
    await as(sam);
    expect((await create("daily-driver")).rows).toHaveLength(1);
  });
  it("shows visitors published setups only and blocks edits by anyone else", async () => {
    await db.exec(`set role anon; set "request.jwt.claim.sub" = '';`);
    const visible = await db.query<{ slug: string }>(
      "select s.slug from public.setups s join public.profiles p using (user_id) where p.handle = 'eliancoder'",
    );
    expect(visible.rows).toEqual([{ slug: "daily-driver" }]);
    await expect(create("anon-setup")).rejects.toBeDefined();
    await as(sam);
    expect((await db.query("update public.setups set title = 'Hijacked', revision = revision + 1 where slug = 'private-notes' returning id")).rows).toEqual([]);
    expect((await db.query("delete from public.setups where slug = 'private-notes' returning id")).rows).toEqual([]);
    await as(ian);
    expect((await db.query("select slug from public.setups order by slug")).rows).toEqual([{ slug: "daily-driver" }, { slug: "daily-driver" }, { slug: "private-notes" }]);
  });
  it("rejects stale writes, malformed items and oversized setups", async () => {
    await as(ian);
    const update = (expected: number) =>
      db.query("update public.setups set title = 'Renamed', revision = $1 + 1 where slug = 'daily-driver' and user_id = auth.uid() and revision = $1 returning revision", [expected]);
    expect((await update(1)).rows).toEqual([{ revision: 2 }]);
    expect((await update(1)).rows).toEqual([]);
    await expect(db.query("update public.setups set title = 'Skip', revision = 9 where slug = 'private-notes'")).rejects.toMatchObject({ code: "40001" });
    for (const bad of ["{}", "[]", JSON.stringify([{ note: "x".repeat(65000) }])])
      await expect(db.query("insert into public.setups(slug, title, items) values ('bad', 'Bad', $1::jsonb)", [bad])).rejects.toMatchObject({ code: "23514" });
  });
});
