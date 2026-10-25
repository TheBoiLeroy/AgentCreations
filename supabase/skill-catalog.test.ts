import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

let db: PGlite;
const maintainer = "11111111-1111-4111-8111-111111111111";
const ordinary = "22222222-2222-4222-8222-222222222222";
async function asUser(id: string, anonymous = false) {
  await db.exec(
    `set role authenticated; set "request.jwt.claim.sub" = '${id}'; set "request.jwt.claims" = '{"is_anonymous":${anonymous}}';`,
  );
}
async function start() {
  return (
    await db.query<{ id: string }>("select * from public.start_catalog_sync()")
  ).rows[0].id;
}
function entries(count: number, offset = 0) {
  return Array.from({ length: count }, (_, i) => ({
    id: `example/skills/skill-${i + offset}`,
    source: "example/skills",
    slug: `skill-${i + offset}`,
  }));
}
async function page(
  run: string,
  pageNumber: number,
  total: number,
  more: boolean,
  data: unknown,
) {
  return db.query(
    "select * from public.stage_catalog_page($1,$2,$3,$4,$5::jsonb)",
    [run, pageNumber, total, more, JSON.stringify(data)],
  );
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${maintainer}'), ('${ordinary}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid(),auth.jwt() to anon,authenticated;`);
  await db.exec(
    await readFile(
      "supabase/migrations/202610180002_skill_catalog.sql",
      "utf8",
    ),
  );
  await db.query("insert into public.catalog_maintainers values($1)", [
    maintainer,
  ]);
}, 30000);
afterAll(async () => db.close());

describe.sequential("catalog SQL authorization and atomic publication", () => {
  it("blocks regular users, anonymous users, and self-promotion", async () => {
    await asUser(ordinary);
    await expect(start()).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.query("insert into public.catalog_maintainers values($1)", [ordinary]),
    ).rejects.toMatchObject({ code: "42501" });
    await asUser(maintainer, true);
    await expect(start()).rejects.toMatchObject({ code: "42501" });
    await db.exec("set role anon");
    await expect(start()).rejects.toMatchObject({ code: "42501" });
  });
  it("hides staging rows, publishes complete generations, and preserves curation", async () => {
    await asUser(maintainer);
    const first = await start();
    await page(first, 0, 1, false, entries(1));
    await db.query(
      "select * from public.curate_catalog($1,$2,$3,$4::jsonb,$5)",
      ["example/skills", "excluded", "Review required", "{}", 0],
    );
    const next = await start();
    await page(next, 0, 501, true, entries(500));
    await asUser(ordinary);
    expect(
      (await db.query("select * from public.catalog_entries")).rows,
    ).toHaveLength(1);
    expect(
      (await db.query("select * from public.catalog_runs")).rows,
    ).toHaveLength(1);
    expect(
      (await db.query("select * from public.catalog_audit")).rows,
    ).toHaveLength(0);
    await asUser(maintainer);
    await expect(
      page(next, 1, 502, false, entries(2, 500)),
    ).rejects.toMatchObject({ code: "22023" });
    await expect(page(next, 1, 501, false, entries(1))).rejects.toMatchObject({
      code: "23505",
    });
    await page(next, 1, 501, false, entries(1, 500));
    await expect(
      page(next, 1, 501, false, entries(1, 500)),
    ).rejects.toMatchObject({ code: "40001" });
    await asUser(ordinary);
    expect(
      (await db.query("select * from public.catalog_entries")).rows,
    ).toHaveLength(501);
    expect(
      (
        await db.query<{ decision: string }>(
          "select * from public.catalog_overrides",
        )
      ).rows[0].decision,
    ).toBe("excluded");
  });
  it("rejects stale curation, prevents direct writes, and records before/after", async () => {
    await asUser(maintainer);
    await expect(
      db.query("select * from public.curate_catalog($1,$2,$3,$4::jsonb,$5)", [
        "example/skills",
        "unreviewed",
        "Changed",
        "{}",
        0,
      ]),
    ).rejects.toMatchObject({ code: "40001" });
    await db.query(
      "select * from public.curate_catalog($1,$2,$3,$4::jsonb,$5)",
      ["example/skills", "flagged", "New evidence", '{"shell":true}', 1],
    );
    const audit = await db.query<{
      before_value: { decision: string };
      after_value: { revision: number };
    }>(
      "select * from public.catalog_audit where action='curate' order by id desc limit 1",
    );
    expect(audit.rows[0].before_value.decision).toBe("excluded");
    expect(audit.rows[0].after_value.revision).toBe(2);
    await expect(
      db.exec("update public.catalog_overrides set decision='approved-source'"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.exec("delete from public.catalog_audit"),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("cannot publish an older sync over a newer generation", async () => {
    await asUser(maintainer);
    const old = await start();
    const newer = await start();
    await page(newer, 0, 1, false, entries(1));
    await expect(page(old, 0, 1, false, entries(1))).rejects.toMatchObject({
      code: "40001",
    });
  });
});
