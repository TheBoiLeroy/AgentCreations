import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { authorizeUrl, githubConfigured, siteOrigin } from "../../../lib/server/github";
const STATE_COOKIE = "ac_oauth_state";
// Starts GitHub sign-in. The state cookie ties the callback to this browser.
export async function GET(request: Request) {
  const origin = siteOrigin(request);
  if (!githubConfigured()) return Response.redirect(new URL("/me?auth=unavailable", origin), 303);
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/auth/callback",
    maxAge: 600,
  });
  return Response.redirect(authorizeUrl(origin, state), 303);
}
