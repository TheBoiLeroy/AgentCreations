import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { currentUser, startSession } from "../../../lib/server/auth";
import { githubAccount, githubConfigured, siteOrigin } from "../../../lib/server/github";
import { database } from "../../../lib/server/store/db";
import { githubUser } from "../../../lib/server/store/users";
import { HandleTaken, upsertProfile } from "../../../lib/server/store/setups";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
// Finishes GitHub sign-in and creates or refreshes the profile. Only redirects to fixed paths here.
export async function GET(request: Request) {
  const origin = siteOrigin(request);
  const to = (path: string) => Response.redirect(new URL(path, origin), 303);
  if (!githubConfigured()) return to("/me?auth=unavailable");
  const url = new URL(request.url);
  const jar = await cookies();
  const expected = jar.get("ac_oauth_state")?.value || "";
  jar.delete("ac_oauth_state");
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!code || code.length > 500 || !expected || !same(state, expected)) return to("/me?auth=failed");
  try {
    const github = await githubAccount(code, origin);
    const db = await database();
    const user = await githubUser(db, await currentUser(), github);
    await upsertProfile(db, user.id, github);
    await startSession(user.id);
    return to("/me");
  } catch (error) {
    return to(error instanceof HandleTaken ? "/me?auth=handle" : "/me?auth=failed");
  }
}
