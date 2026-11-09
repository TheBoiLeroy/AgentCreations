import "server-only";
import { z } from "zod";
import { handleSchema, setupSchema } from "@agents/spec/setups";
import { triggerSchema } from "@agents/spec";
import { ApiError, cloudConfigured, serverClient } from "./builds";
import { publicCatalogDatabase } from "./catalog";

const summary = "id, slug, title, description, item_count, published, revision, updated_at";
const owner = "profiles!inner(handle, display_name, avatar_url)";
const unavailable = () =>
  new ApiError(503, "Profiles and setups are unavailable. Check the profiles_setups migration.");
export const notConfigured = () =>
  new ApiError(503, "Profiles need cloud storage, which is not configured on this site.");

/** The signed-in GitHub account and its profile. Anonymous builder sessions don't count. */
export async function account() {
  if (!cloudConfigured()) throw notConfigured();
  const client = await serverClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous)
    throw new ApiError(401, "Sign in with GitHub to publish setups.");
  const { data: profile, error } = await client
    .from("profiles")
    .select("handle, display_name, avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw unavailable();
  if (!profile) throw new ApiError(401, "Sign in with GitHub to publish setups.");
  return { client, profile };
}
export async function mySetups() {
  const { client, profile } = await account();
  const { data, error } = await client
    .from("setups")
    .select(`${summary}, items, ${owner}`)
    .eq("profiles.handle", profile.handle)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw unavailable();
  return { profile, setups: data };
}
/** Published setups only: read without a session so drafts can never leak. */
export async function publishedSetups(query: { handle?: string; slug?: string }) {
  if (!cloudConfigured()) throw notConfigured();
  const client = publicCatalogDatabase();
  if (!query.handle) {
    const { data, error } = await client
      .from("setups")
      .select(`${summary}, ${owner}`)
      .eq("published", true)
      .order("updated_at", { ascending: false })
      .limit(60);
    if (error) throw unavailable();
    return { setups: data };
  }
  const handle = handleSchema.parse(query.handle.toLowerCase());
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("handle, display_name, avatar_url")
    .eq("handle", handle)
    .maybeSingle();
  if (profileError) throw unavailable();
  if (!profile) throw new ApiError(404, "No profile with that name.");
  const rows = client
    .from("setups")
    .select(`${summary}${query.slug ? ", items" : ""}, ${owner}`)
    .eq("published", true)
    .eq("profiles.handle", handle);
  if (query.slug) {
    const { data, error } = await rows.eq("slug", triggerSchema.parse(query.slug)).maybeSingle();
    if (error) throw unavailable();
    if (!data) throw new ApiError(404, "This setup doesn't exist or isn't published.");
    return { profile, setup: data };
  }
  const { data, error } = await rows.order("updated_at", { ascending: false }).limit(100);
  if (error) throw unavailable();
  return { profile, setups: data };
}
const conflict = (code?: string) =>
  code === "23505"
    ? new ApiError(409, "You already have a setup with this name. Change the title.")
    : code === "40001"
      ? new ApiError(409, "This setup changed in another tab. Reload before saving.")
      : unavailable();
export async function createSetup(body: unknown) {
  const setup = setupSchema.parse(body);
  const { client } = await account();
  const { data, error } = await client.from("setups").insert(setup).select(`${summary}, items`).single();
  if (error) throw conflict(error.code);
  return data;
}
const updateSchema = z
  .object({ setup: setupSchema, revision: z.number().int().positive() })
  .strict();
export async function updateSetup(id: string, body: unknown) {
  z.string().uuid().parse(id);
  const { setup, revision } = updateSchema.parse(body);
  const { client } = await account();
  // RLS limits this to the owner; the revision filter and trigger reject stale writes.
  const { data, error } = await client
    .from("setups")
    .update({ ...setup, revision: revision + 1 })
    .eq("id", id)
    .eq("revision", revision)
    .select(`${summary}, items`)
    .maybeSingle();
  if (error) throw conflict(error.code);
  if (!data) throw conflict("40001");
  return data;
}
export async function deleteSetup(id: string) {
  z.string().uuid().parse(id);
  const { client } = await account();
  const { data, error } = await client.from("setups").delete().eq("id", id).select("id").maybeSingle();
  if (error) throw unavailable();
  if (!data) throw new ApiError(404, "Setup not found.");
}
