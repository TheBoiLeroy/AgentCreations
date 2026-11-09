import { ApiError, assertSameOrigin, cloudConfigured, serverClient } from "../../../lib/server/builds";
export async function POST(request: Request) {
  const home = new URL("/", new URL(request.url).origin);
  try {
    assertSameOrigin(request);
    if (cloudConfigured()) await (await serverClient()).auth.signOut();
  } catch (error) {
    if (error instanceof ApiError && error.status === 403)
      return Response.json({ error: error.message }, { status: 403 });
  }
  return Response.redirect(home, 303);
}
