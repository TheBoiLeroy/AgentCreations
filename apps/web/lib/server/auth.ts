import "server-only";
import { cookies } from "next/headers";
import { database } from "./store/db";
import { createSession, createUser, deleteSession, sessionUser, SESSION_DAYS, type User } from "./store/users";

export const SESSION_COOKIE = "ac_session";
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_DAYS * 86400,
};
export async function currentUser(): Promise<User | undefined> {
  const jar = await cookies();
  return sessionUser(await database(), jar.get(SESSION_COOKIE)?.value);
}
/** The visitor's account, created anonymously on their first save. */
export async function ensureUser(): Promise<User> {
  const existing = await currentUser();
  if (existing) return existing;
  const db = await database();
  const user = await createUser(db, "anonymous");
  await startSession(user.id);
  return user;
}
/** Replaces the current session (prevents session fixation across sign-in). */
export async function startSession(userId: string) {
  const db = await database();
  const jar = await cookies();
  await deleteSession(db, jar.get(SESSION_COOKIE)?.value);
  const { token } = await createSession(db, userId);
  jar.set(SESSION_COOKIE, token, cookieOptions);
}
export async function endSession() {
  const jar = await cookies();
  await deleteSession(await database(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
}
