import { database } from "../../../lib/server/store/db";
import { publishedRun } from "../../../lib/server/store/catalog";

// Status only until the searchable discovery UI is implemented. Jev continues
// using the bundled catalog; a successful sync does not endorse remote entries.
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const run = await publishedRun(await database());
    return Response.json(
      {
        mode: "bundled",
        index: run ? "available" : "not-yet-published",
        generation: run?.id ?? null,
        publishedAt: run?.published_at ?? null,
        indexedCount: run?.expected_total ?? 0,
        coverage: "skills.sh global serving window, up to 100000 entries; not all open-source skills",
        liveRefreshConfigured: !!process.env.VERCEL_OIDC_TOKEN,
      },
      { headers },
    );
  } catch {
    return Response.json({ mode: "bundled", reason: "storage-unavailable", publishedAt: null }, { headers });
  }
}
