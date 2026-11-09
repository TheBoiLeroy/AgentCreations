import { cloudConfigured, serverClient } from "../../../lib/server/builds";
// Finishes GitHub sign-in, then creates or refreshes the profile from the GitHub identity.
// Only ever redirects to fixed paths on this origin.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const to = (path: string) => Response.redirect(new URL(path, url.origin), 303);
  if (!cloudConfigured()) return to("/me?auth=unavailable");
  // This GitHub account already belongs to a user: sign in to it instead of linking.
  if (url.searchParams.get("error_code") === "identity_already_exists")
    return to("/auth/sign-in?fresh=1");
  const code = url.searchParams.get("code");
  if (!code || code.length > 500) return to("/me?auth=failed");
  try {
    const client = await serverClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) return to("/me?auth=failed");
    const { error: profileError } = await client.rpc("claim_profile");
    return to(profileError ? "/me?auth=profile" : "/me");
  } catch {
    return to("/me?auth=failed");
  }
}
