import { z } from "zod";
import { handleSchema } from "@agents/spec/setups";
import { ApiError, assertSameOrigin } from "../../../lib/server/builds";
import { currentUser, startSession } from "../../../lib/server/auth";
import { devSignInAllowed, siteOrigin } from "../../../lib/server/github";
import { database, one, writeTransaction } from "../../../lib/server/store/db";
import { createUser } from "../../../lib/server/store/users";
import { upsertProfile } from "../../../lib/server/store/setups";

// Local development only: sign in as a handle without a GitHub OAuth app.
// Never reaches a GitHub account's profile, and is off in production builds.
export async function POST(request: Request) {
  const origin = siteOrigin(request);
  const to = (path: string) => Response.redirect(new URL(path, origin), 303);
  if (!devSignInAllowed(request)) return Response.json({ error: "Not available." }, { status: 404 });
  try {
    assertSameOrigin(request);
  } catch (error) {
    if (error instanceof ApiError) return Response.json({ error: error.message }, { status: 403 });
  }
  const form = await request.formData();
  const parsed = z.object({ handle: handleSchema }).safeParse({ handle: String(form.get("handle") || "").trim().toLowerCase() });
  if (!parsed.success) return to("/me?auth=dev-handle");
  const { handle } = parsed.data;
  const db = await database();
  const current = await currentUser();
  const userId = await writeTransaction(db, async (tx) => {
    const owner = await one<{ user_id: string; kind: string }>(
      tx,
      "select p.user_id, u.kind from profiles p join users u on u.id = p.user_id where p.handle = ?",
      [handle],
    );
    if (owner) return owner.kind === "dev" ? owner.user_id : null;
    // A visitor's anonymous drafts follow them into the dev account.
    if (current?.kind === "anonymous") {
      await tx.execute({ sql: "update users set kind = 'dev' where id = ?", args: [current.id] });
      await upsertProfile(tx, current.id, { login: handle, name: null, avatar_url: null });
      return current.id;
    }
    const user = await createUser(tx, "dev");
    await upsertProfile(tx, user.id, { login: handle, name: null, avatar_url: null });
    return user.id;
  });
  if (!userId) return to("/me?auth=handle");
  await startSession(userId);
  return to("/me");
}
