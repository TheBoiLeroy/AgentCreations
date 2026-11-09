import "server-only";
import { z } from "zod";
import { handleSchema, setupSchema } from "@agents/spec/setups";
import { triggerSchema } from "@agents/spec";
import { ApiError } from "./builds";
import { currentUser } from "./auth";
import { database } from "./store/db";
import * as store from "./store/setups";

/** The signed-in GitHub (or local dev) account and its profile. Anonymous builder sessions don't count. */
export async function account() {
  const user = await currentUser();
  const db = await database();
  const profile = user && user.kind !== "anonymous" ? await store.getProfile(db, user.id) : undefined;
  if (!user || !profile) throw new ApiError(401, "Sign in with GitHub to publish setups.");
  return { db, user, profile };
}
export async function mySetups() {
  const { db, user, profile } = await account();
  return { profile, setups: await store.mySetups(db, user.id) };
}
export async function publishedSetups(query: { handle?: string; slug?: string }) {
  const db = await database();
  if (!query.handle) return { setups: await store.publishedSetups(db) };
  const handle = handleSchema.parse(query.handle.toLowerCase());
  const owner = await store.profileByHandle(db, handle);
  if (!owner) throw new ApiError(404, "No profile with that name.");
  const profile = { handle: owner.handle, display_name: owner.display_name, avatar_url: owner.avatar_url };
  if (query.slug) {
    const setup = await store.publishedSetup(db, handle, triggerSchema.parse(query.slug));
    if (!setup) throw new ApiError(404, "This setup doesn't exist or isn't published.");
    return { profile, setup };
  }
  return { profile, setups: await store.publishedSetups(db, handle) };
}
export async function createSetup(body: unknown) {
  const setup = setupSchema.parse(body);
  const { db, user } = await account();
  return store.createSetup(db, user.id, setup);
}
const updateSchema = z.object({ setup: setupSchema, revision: z.number().int().positive() }).strict();
export async function updateSetup(id: string, body: unknown) {
  z.string().uuid().parse(id);
  const { setup, revision } = updateSchema.parse(body);
  const { db, user } = await account();
  return store.updateSetup(db, user.id, id, setup, revision);
}
export async function deleteSetup(id: string) {
  z.string().uuid().parse(id);
  const { db, user } = await account();
  if (!(await store.deleteSetup(db, user.id, id))) throw new ApiError(404, "Setup not found.");
}
