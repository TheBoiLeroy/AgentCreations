import { randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import type { Setup } from "@agents/spec/setups";
import { isUniqueViolation, json, now, one, rows, type Db } from "./db";
import { StoreConflict } from "./builds";
import type { GithubAccount } from "./users";

export interface Profile {
  handle: string;
  display_name: string;
  avatar_url: string | null;
}
export interface SetupRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  item_count: number;
  published: boolean;
  revision: number;
  updated_at: string;
  items?: unknown;
  profiles: Profile;
}
export class HandleTaken extends Error {}
const avatar = (url: string | null) =>
  url && url.length <= 300 && url.startsWith("https://avatars.githubusercontent.com/") ? url : null;
export async function getProfile(db: Db, userId: string) {
  return one<Profile>(db, "select handle, display_name, avatar_url from profiles where user_id = ?", [userId]);
}
export async function profileByHandle(db: Db, handle: string) {
  return one<Profile & { user_id: string }>(db, "select user_id, handle, display_name, avatar_url from profiles where handle = ?", [handle]);
}
/** The handle comes from the GitHub login (or a dev sign-in), never from a form. */
export async function upsertProfile(db: Db, userId: string, account: Pick<GithubAccount, "login" | "name" | "avatar_url">) {
  const handle = account.login.toLowerCase();
  const name = (account.name || "").trim().slice(0, 80) || handle;
  try {
    await db.execute({
      sql: `insert into profiles (user_id, handle, display_name, avatar_url) values (?, ?, ?, ?)
            on conflict (user_id) do update set handle = excluded.handle, display_name = excluded.display_name, avatar_url = excluded.avatar_url`,
      args: [userId, handle, name, avatar(account.avatar_url)],
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new HandleTaken(handle);
    throw error;
  }
  return (await getProfile(db, userId))!;
}
type Raw = Omit<SetupRow, "published" | "items" | "profiles"> & { published: number; items?: string } & Profile;
const fields = (items: boolean) =>
  `s.id, s.slug, s.title, s.description, s.item_count, s.published, s.revision, s.updated_at${items ? ", s.items" : ""}, p.handle, p.display_name, p.avatar_url`;
const shape = ({ handle, display_name, avatar_url, published, items, ...row }: Raw): SetupRow => ({
  ...row,
  published: !!published,
  ...(items === undefined ? {} : { items: json(items) }),
  profiles: { handle, display_name, avatar_url },
});
const from = "from setups s join profiles p on p.user_id = s.user_id";
export async function mySetups(db: Client, userId: string) {
  return (await rows<Raw>(db, `select ${fields(true)} ${from} where s.user_id = ? order by s.updated_at desc limit 100`, [userId])).map(shape);
}
/** Published setups only. Visitors can never read a private draft. */
export async function publishedSetups(db: Client, handle?: string) {
  return (
    await rows<Raw>(
      db,
      `select ${fields(false)} ${from} where s.published = 1 ${handle ? "and p.handle = ?" : ""} order by s.updated_at desc limit ${handle ? 100 : 60}`,
      handle ? [handle] : [],
    )
  ).map(shape);
}
export async function publishedSetup(db: Client, handle: string, slug: string) {
  const row = await one<Raw>(db, `select ${fields(true)} ${from} where s.published = 1 and p.handle = ? and s.slug = ?`, [handle, slug]);
  return row && shape(row);
}
const unchecked = (setup: Setup) => [setup.slug, setup.title, setup.description, JSON.stringify(setup.items), setup.published ? 1 : 0];
export async function createSetup(db: Client, userId: string, setup: Setup) {
  const id = randomUUID();
  try {
    await db.execute({
      sql: "insert into setups (id, user_id, slug, title, description, items, published, updated_at, item_count) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [id, userId, ...unchecked(setup), now(), setup.items.length],
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new StoreConflict("You already have a setup with this name. Change the title.");
    throw error;
  }
  return (await mySetups(db, userId)).find((row) => row.id === id)!;
}
/** Owner-only, at the revision the editor read. Anything else is a conflict, not an overwrite. */
export async function updateSetup(db: Client, userId: string, id: string, setup: Setup, revision: number) {
  let result;
  try {
    result = await db.execute({
      sql: "update setups set slug = ?, title = ?, description = ?, items = ?, published = ?, revision = revision + 1, updated_at = ?, item_count = ? where id = ? and user_id = ? and revision = ?",
      args: [...unchecked(setup), now(), setup.items.length, id, userId, revision],
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new StoreConflict("You already have a setup with this name. Change the title.");
    throw error;
  }
  if (!result.rowsAffected) throw new StoreConflict("This setup changed in another tab. Reload before saving.");
  return (await mySetups(db, userId)).find((row) => row.id === id)!;
}
export async function deleteSetup(db: Client, userId: string, id: string) {
  return (await db.execute({ sql: "delete from setups where id = ? and user_id = ?", args: [id, userId] })).rowsAffected > 0;
}
/** Published skills by name, so "grill-me" can be resolved to the repositories people actually use. */
export async function publishedSkillSources(db: Client, names: string[]) {
  if (!names.length) return [];
  return rows<{ name: string; repository: string; uses: number }>(
    db,
    `select lower(json_extract(i.value, '$.skill')) as name, json_extract(i.value, '$.repository') as repository, count(*) as uses
     from setups s, json_each(s.items) i
     where s.published = 1 and json_extract(i.value, '$.kind') = 'skill'
       and lower(json_extract(i.value, '$.skill')) in (${names.map(() => "?").join(", ")})
     group by 1, 2 order by uses desc limit 200`,
    names,
  );
}
