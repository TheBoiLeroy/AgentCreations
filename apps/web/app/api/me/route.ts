import { ApiError, apiError } from "../../../lib/server/builds";
import { mySetups } from "../../../lib/server/setups";
import { devSignInAllowed, githubConfigured } from "../../../lib/server/github";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const signIn = { github: githubConfigured(), dev: devSignInAllowed(request) };
  try {
    return Response.json({ configured: true, signIn, ...(await mySetups()) }, { headers });
  } catch (error) {
    // Signed out is a normal state here, not a failure.
    if (error instanceof ApiError && error.status === 401)
      return Response.json({ configured: true, signIn, profile: null, setups: [] }, { headers });
    return apiError(error);
  }
}
