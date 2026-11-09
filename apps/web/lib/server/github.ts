import "server-only";
import { z } from "zod";
import type { GithubAccount } from "./store/users";

export const githubConfigured = () => !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
/** The site's own origin. APP_URL wins so a forged Host header can't redirect the OAuth flow. */
export function siteOrigin(request: Request) {
  if (process.env.APP_URL) return new URL(process.env.APP_URL).origin;
  const url = new URL(request.url);
  const host = request.headers.get("host");
  return host ? `${url.protocol}//${host}` : url.origin;
}
export function authorizeUrl(origin: string, state: string) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID!);
  url.searchParams.set("redirect_uri", `${origin}/auth/callback`);
  // No scope: the public profile is all a handle and avatar need.
  url.searchParams.set("scope", "");
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "true");
  return url.toString();
}
const accountSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/),
  name: z.string().nullable(),
  avatar_url: z.string().nullable(),
});
/** Exchanges the code and reads the public profile. The access token is used once and never stored. */
export async function githubAccount(code: string, origin: string, fetcher: typeof fetch = fetch): Promise<GithubAccount> {
  const tokenResponse = await fetcher("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${origin}/auth/callback`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const token = z.object({ access_token: z.string().min(1) }).safeParse(await tokenResponse.json());
  if (!tokenResponse.ok || !token.success) throw new Error("GitHub code exchange failed");
  const userResponse = await fetcher("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token.data.access_token}`,
      "User-Agent": "agent-creations",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!userResponse.ok) throw new Error("GitHub profile unavailable");
  return accountSchema.parse(await userResponse.json());
}
/** Dev sign-in: only under `next dev`, only from this machine, and switchable off. */
export function devSignInAllowed(request: Request) {
  const host = (request.headers.get("host") || "").replace(/:\d+$/, "");
  return (
    process.env.NODE_ENV === "development" &&
    process.env.ALLOW_DEV_SIGN_IN !== "0" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(host)
  );
}
