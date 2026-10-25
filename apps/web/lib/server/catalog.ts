import "server-only";
import { createClient } from "@supabase/supabase-js";
import { ApiError, cloudConfigured, database } from "./builds";

export function publicCatalogDatabase() {
  if (!cloudConfigured())
    throw new ApiError(503, "Catalog storage is not configured.");
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
export async function maintainerDatabase(request: Request) {
  // Allows a real Supabase account session or its short-lived access token.
  // Never accepts a service-role credential or a shared administrator password.
  const authorization = request.headers.get("authorization");
  let client;
  if (authorization) {
    if (!/^Bearer \S+$/.test(authorization))
      throw new ApiError(401, "Account authentication required.");
    if (!cloudConfigured())
      throw new ApiError(503, "Catalog storage is not configured.");
    client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: authorization } },
      },
    );
    const { data, error } = await client.auth.getUser(authorization.slice(7));
    if (error || !data.user || data.user.is_anonymous)
      throw new ApiError(
        401,
        "A non-anonymous maintainer account is required.",
      );
  } else {
    client = await database();
  }
  const { data: allowed, error } = await client.rpc("is_catalog_maintainer");
  if (error) throw new ApiError(503, "Catalog authorization is unavailable.");
  if (allowed !== true) throw new ApiError(403, "Maintainer access required.");
  return client;
}
export function catalogDatabaseError(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "40001" || error.code === "23505")
    throw new ApiError(
      409,
      "Catalog changed or a page was already staged. Reload before retrying.",
    );
  if (error.code === "42501")
    throw new ApiError(403, "Maintainer access required.");
  throw new ApiError(
    503,
    "Catalog operation failed; the previous published catalog remains available.",
  );
}
