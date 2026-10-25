import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { z } from "zod";
import { draftSchema, triggerFromName } from "@agents/spec";
import { createAgentSpec, validateDraftCatalog } from "@agents/jev";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const cloudConfigured = () =>
  !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
export async function database(createSession = false) {
  if (!cloudConfigured())
    throw new ApiError(
      503,
      "Cloud drafts are not configured. Your draft is saved on this device.",
    );
  const jar = await cookies();
  const client = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (entries) =>
          entries.forEach(({ name, value, options }) =>
            jar.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
            }),
          ),
      },
    },
  );
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    if (!createSession)
      throw new ApiError(
        401,
        "This browser session has expired. Your local draft is still available.",
      );
    const { error } = await client.auth.signInAnonymously();
    if (error)
      throw new ApiError(
        503,
        "Cloud sign-in failed. Enable anonymous sign-ins in Supabase.",
      );
  }
  return client;
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
  const spec = complete ? createAgentSpec(draft, base!) : null;
  if (complete && draft.step !== "install")
    throw new ApiError(400, "Review the agent before creating it.");
  const client = await database(create);
  const { data, error } = await client.rpc("save_agent_build", {
    p_id: id,
    p_draft: draft,
    p_base: base,
    p_expected_revision: revision,
    p_spec: spec,
  });
  if (error) {
    if (error.code === "40001" || error.code === "23505")
      throw new ApiError(
        409,
        "This build changed in another tab. Reload the cloud version before saving.",
      );
    throw new ApiError(
      503,
      "Cloud save failed. Check the agent_builds migration and permissions.",
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.id !== id || typeof row.revision !== "number")
    throw new ApiError(503, "Cloud returned an invalid save response.");
  return row;
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
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
  if (error instanceof z.ZodError)
    return Response.json(
      {
        error: "Invalid agent build.",
        issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      { status: 400 },
    );
  return Response.json(
    { error: "Request could not be completed." },
    { status: 400 },
  );
}
