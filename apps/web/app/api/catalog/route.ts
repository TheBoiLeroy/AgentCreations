import { cloudConfigured } from "../../../lib/server/builds";
import { publicCatalogDatabase } from "../../../lib/server/catalog";

// Status only until the searchable discovery UI is implemented. Jev continues
// using the bundled catalog; a successful sync does not endorse remote entries.
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (!cloudConfigured())
    return Response.json(
      { mode: "bundled", reason: "storage-not-configured", publishedAt: null },
      { headers },
    );
  try {
    const client = publicCatalogDatabase();
    const { data, error } = await client
      .from("catalog_runs")
      .select("id,expected_total,published_at")
      .eq("status", "published")
      .maybeSingle();
    if (error) throw error;
    return Response.json(
      {
        mode: "bundled",
        index: data ? "available" : "not-yet-published",
        generation: data?.id ?? null,
        publishedAt: data?.published_at ?? null,
        indexedCount: data?.expected_total ?? 0,
        coverage:
          "skills.sh global serving window, up to 100000 entries; not all open-source skills",
        liveRefreshConfigured: !!process.env.VERCEL_OIDC_TOKEN,
      },
      { headers },
    );
  } catch {
    return Response.json(
      { mode: "bundled", reason: "storage-unavailable", publishedAt: null },
      { headers },
    );
  }
}
