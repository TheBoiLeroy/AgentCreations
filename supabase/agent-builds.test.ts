import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const id1 = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  id2 = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
async function asUser(id: string) {
  await db.exec(
    `set role authenticated; set "request.jwt.claim.sub" = '${id}';`,
  );
}
async function save(
  id: string,
  revision: number,
  name = "Quote Writer",
  base = "quote-writer",
  spec: unknown = null,
) {
  return (
    await db.query<{
      trigger: string;
      revision: number;
      spec: { trigger: string; slug: string };
    }>(
      "select * from public.save_agent_build($1, $2::jsonb, $3, $4, $5::jsonb)",
      [
        id,
        JSON.stringify({ name, step: "name" }),
        base,
        revision,
        spec ? JSON.stringify(spec) : null,
      ],
    )
  ).rows[0];
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'), ('${other}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to authenticated;
    grant execute on function auth.uid() to authenticated;`);
  await db.exec(
    await readFile("supabase/migrations/202610180001_agent_builds.sql", "utf8"),
  );
}, 30000);
afterAll(async () => {
  await db.close();
});
describe.sequential(
  "Supabase migration and draft transaction (real Postgres engine)",
  () => {
    it("allocates per-user unique triggers and preserves existing allocations", async () => {
      await asUser(owner);
      expect((await save(id1, 0)).trigger).toBe("quote-writer");
      expect((await save(id2, 0)).trigger).toBe("quote-writer-2");
      expect((await save(id2, 1)).trigger).toBe("quote-writer-2");
      expect((await save(id2, 2, "New Name", "new-name")).trigger).toBe(
        "new-name",
      );
    });
    it("rejects stale writes instead of overwriting another tab", async () => {
      await asUser(owner);
      await expect(save(id1, 0)).rejects.toMatchObject({ code: "40001" });
      expect((await save(id1, 1)).revision).toBe(2);
    });
    it("enforces RLS ownership and allows another owner to reuse the name", async () => {
      await asUser(other);
      expect(
        (await db.query("select * from public.agent_builds")).rows,
      ).toEqual([]);
      const updated = await db.query(
        "update public.agent_builds set revision = 100 where id = $1 returning id",
        [id1],
      );
      expect(updated.rows).toEqual([]);
      await expect(save(id1, 0)).rejects.toBeDefined();
      expect(
        (await save("cccccccc-cccc-4ccc-accc-cccccccccccc", 0)).trigger,
      ).toBe("quote-writer");
    });
    it("sets the same allocated trigger in the saved spec and compatibility slug", async () => {
      await asUser(owner);
      const row = await save(id1, 2, "Quote Writer", "quote-writer", {
        trigger: "wrong",
        slug: "wrong",
      });
      expect(row.spec.trigger).toBe("quote-writer");
      expect(row.spec.slug).toBe(row.trigger);
    });
    it("enforces the unique owner/trigger index even outside the RPC", async () => {
      await asUser(owner);
      await expect(
        db.query(
          "insert into public.agent_builds(id,user_id,trigger,draft) values ($1,$2,$3,$4)",
          ["dddddddd-dddd-4ddd-addd-dddddddddddd", owner, "quote-writer", "{}"],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    });
  },
);
