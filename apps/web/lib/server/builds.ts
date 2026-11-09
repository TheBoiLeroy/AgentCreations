import "server-only";
import { z } from "zod";
import { draftSchema, parseAgentSpec, triggerFromName } from "@agents/spec";
import { createAgentSpec, validateDraftCatalog } from "@agents/jev";
import { currentUser, ensureUser } from "./auth";
import { database } from "./store/db";
import { getBuild, listBuilds, saveBuild as store, StoreConflict } from "./store/builds";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
/** Storage is always available: a local Turso file by default, Turso Cloud when configured. */
export const cloudConfigured = () => true;
export async function signedIn() {
  const user = await currentUser();
  if (!user)
    throw new ApiError(401, "This browser session has expired. Your local draft is still available.");
  return user;
}
export async function myBuilds() {
  const user = await currentUser();
  return user ? listBuilds(await database(), user.id) : [];
}
export async function myBuild(id: string) {
  z.string().uuid().parse(id);
  const user = await signedIn();
  const row = await getBuild(await database(), user.id, id);
  if (!row) throw new ApiError(404, "Build not found in this session.");
  return row;
}
export const saveSchema = z
  .object({
    draft: draftSchema,
    revision: z.number().int().nonnegative(),
    complete: z.boolean().default(false),
  })
  .strict();
export async function saveBuild(id: string, body: unknown, create = false) {
  z.string().uuid().parse(id);
  const { draft, revision, complete } = saveSchema.parse(body);
  if (create && revision !== 0)
    throw new ApiError(400, "New builds start at revision zero.");
  if (!create && revision === 0)
    throw new ApiError(400, "Create the build before patching it.");
  validateDraftCatalog(draft);
  const base = draft.name.trim() ? triggerFromName(draft.name) : null;
  if (complete && draft.step !== "install")
    throw new ApiError(400, "Review the agent before creating it.");
  const spec = complete ? createAgentSpec(draft, base!) : null;
  const user = create ? await ensureUser() : await signedIn();
  try {
    const row = await store(await database(), user.id, {
      id,
      draft,
      base,
      expectedRevision: revision,
      spec: spec as Record<string, unknown> | null,
    });
    return { ...row, spec: row.spec ? parseAgentSpec(row.spec) : null };
  } catch (error) {
    if (error instanceof StoreConflict)
      throw new ApiError(409, "This build changed in another tab. Reload the cloud version before saving.");
    throw error;
  }
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  // Compare with the host the browser addressed. `request.url` can name a different
  // host than the page (Next dev reports localhost when serving 127.0.0.1).
  const host = request.headers.get("host") || new URL(request.url).host;
  let sent = "";
  try {
    sent = new URL(origin).host;
  } catch {
    /* "null" and malformed origins are rejected below. */
  }
  if (sent !== host)
    throw new ApiError(403, "Cross-origin writes are not allowed.");
}
export async function readBody(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 64000)
    throw new ApiError(413, "Request too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "JSON body required.");
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 64000) {
        await reader.cancel();
        throw new ApiError(413, "Request too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "Invalid JSON.");
  }
}
export function apiError(error: unknown) {
  if (error instanceof ApiError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof StoreConflict)
    return Response.json({ error: error.message }, { status: 409 });
  if (error instanceof z.ZodError)
    return Response.json(
      {
        error: "Invalid agent build.",
        issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      { status: 400 },
    );
  // Unexpected failures are logged for the operator and never echoed to the browser.
  console.error(error);
  return Response.json(
    { error: "Request could not be completed." },
    { status: 500 },
  );
}
