import { cloudConfigured, serverClient } from "../../../lib/server/builds";
// Starts GitHub sign-in. An anonymous builder session is upgraded in place so its cloud
// drafts stay with the account; `fresh=1` skips that when GitHub is already linked elsewhere.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const fail = (reason: string) => Response.redirect(new URL(`/me?auth=${reason}`, url.origin), 303);
  if (!cloudConfigured()) return fail("unavailable");
  try {
    const client = await serverClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    const oauth = {
      provider: "github" as const,
      options: { redirectTo: `${url.origin}/auth/callback` },
    };
    const { data, error } =
      user?.is_anonymous && !url.searchParams.has("fresh")
        ? await client.auth.linkIdentity(oauth)
        : await client.auth.signInWithOAuth(oauth);
    if (error || !data.url) return fail("failed");
    return Response.redirect(data.url, 303);
  } catch {
    return fail("failed");
  }
}
