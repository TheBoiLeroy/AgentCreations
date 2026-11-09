import { ApiError, assertSameOrigin } from "../../../lib/server/builds";
import { endSession } from "../../../lib/server/auth";
import { siteOrigin } from "../../../lib/server/github";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (error) {
    if (error instanceof ApiError) return Response.json({ error: error.message }, { status: 403 });
  }
  await endSession();
  return Response.redirect(new URL("/", siteOrigin(request)), 303);
}
