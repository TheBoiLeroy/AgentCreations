import { ApiError, apiError, cloudConfigured } from "../../../lib/server/builds";
import { mySetups } from "../../../lib/server/setups";
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (!cloudConfigured())
    return Response.json({ configured: false, profile: null, setups: [] }, { headers });
  try {
    return Response.json({ configured: true, ...(await mySetups()) }, { headers });
  } catch (error) {
    // Signed out is a normal state here, not a failure.
    if (error instanceof ApiError && error.status === 401)
      return Response.json({ configured: true, profile: null, setups: [] }, { headers });
    return apiError(error);
  }
}
