import { afterAll, beforeAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'), ('${other}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to authenticated;
    grant execute on function auth.uid() to authenticated;`);
  await db.exec(await readFile("supabase/migrations/202610250001_skill_requests.sql", "utf8"));
}, 30000);
afterAll(async () => { await db.close(); });
it("records one vote per creator, enforces ownership, and permits admin aggregation", async () => {
  await db.exec(`set role authenticated; set "request.jwt.claim.sub" = '${owner}'`);
  await db.query("insert into public.skill_requests(search_term) values ($1)", ["calendar sync"]);
  await expect(db.query("insert into public.skill_requests(search_term) values ($1)", ["calendar sync"])).rejects.toMatchObject({ code: "23505" });
  await expect(db.query("insert into public.skill_requests(user_id, search_term) values ($1, $2)", [other, "forged"])).rejects.toBeDefined();
  await db.exec(`set "request.jwt.claim.sub" = '${other}'`);
  expect((await db.query("select * from public.skill_requests")).rows).toEqual([]);
  await db.query("insert into public.skill_requests(search_term) values ($1)", ["calendar sync"]);
  await expect(db.query("insert into public.skill_requests(search_term) values ($1)", [" UPPER "])).rejects.toBeDefined();
  await expect(db.query("update public.skill_requests set search_term = 'modified'")).rejects.toBeDefined();
  await db.exec("reset role");
  expect((await db.query("select search_term, count(*)::int as votes from public.skill_requests group by search_term")).rows).toEqual([{ search_term: "calendar sync", votes: 2 }]);
});
