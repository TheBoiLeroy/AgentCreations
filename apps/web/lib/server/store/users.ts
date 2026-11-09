import { createHash, randomBytes, randomUUID } from "node:crypto";
import { now, one, writeTransaction, type Db } from "./db";
import type { Client } from "@libsql/client";

export type UserKind = "anonymous" | "github" | "dev";
export interface User {
  id: string;
  kind: UserKind;
  github_id: number | null;
}
export const SESSION_DAYS = 180;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export async function createUser(db: Db, kind: UserKind, githubId: number | null = null): Promise<User> {
  const user = { id: randomUUID(), kind, github_id: githubId };
  await db.execute({ sql: "insert into users (id, kind, github_id) values (?, ?, ?)", args: [user.id, kind, githubId] });
  return user;
}
/** A new session for `userId`. Only the token's hash is stored; the token goes in the cookie. */
export async function createSession(db: Db, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db.execute({
    sql: "insert into sessions (token_hash, user_id, expires_at) values (?, ?, ?)",
    args: [hashToken(token), userId, expires],
  });
  return { token, expires };
}
export async function sessionUser(db: Db, token: string | undefined): Promise<User | undefined> {
  if (!token || token.length > 100) return undefined;
  return one<User>(
    db,
    "select u.id, u.kind, u.github_id from sessions s join users u on u.id = s.user_id where s.token_hash = ? and s.expires_at > ?",
    [hashToken(token), now()],
  );
}
export async function deleteSession(db: Db, token: string | undefined) {
  if (token) await db.execute({ sql: "delete from sessions where token_hash = ?", args: [hashToken(token)] });
}
export interface GithubAccount {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}
/**
 * Signs in with GitHub. An anonymous visitor is upgraded in place so their drafts stay theirs;
 * an existing GitHub account is reused; anyone else gets a new account.
 */
export async function githubUser(db: Client, current: User | undefined, account: GithubAccount): Promise<User> {
  return writeTransaction(db, async (tx) => {
    const existing = await one<User>(tx, "select id, kind, github_id from users where github_id = ?", [account.id]);
    if (existing) return existing;
    if (current?.kind === "anonymous") {
      await tx.execute({ sql: "update users set kind = 'github', github_id = ? where id = ?", args: [account.id, current.id] });
      return { ...current, kind: "github", github_id: account.id };
    }
    return createUser(tx, "github", account.id);
  });
}
