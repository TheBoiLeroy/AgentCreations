import { z } from "zod";
import { ApiError, apiError, assertSameOrigin, readBody } from "../../../../lib/server/builds";
import { maintainer } from "../../../../lib/server/catalog";
import { curate, getRun, InvalidCatalog, recentRuns, stagePage, startSync } from "../../../../lib/server/store/catalog";
import { CatalogSourceError, curationSchema, fetchCatalogPage } from "../../../../lib/skill-catalog";

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }).strict(),
  z.object({ action: z.literal("advance"), runId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("curate"), change: curationSchema }).strict(),
]);
export async function GET() {
  try {
    const { db } = await maintainer();
    return Response.json({ runs: await recentRuns(db) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { db, user } = await maintainer();
    const command = commandSchema.parse(await readBody(request));
    if (command.action === "curate")
      return Response.json({ override: await curate(db, user.id, command.change as never) });
    // Read fresh on every request. Never accept a source token in browser input.
    const token = process.env.VERCEL_OIDC_TOKEN;
    if (!token) throw new ApiError(503, "Live catalog refresh is unavailable: Vercel OIDC is not configured.");
    if (command.action === "start") return Response.json({ run: await startSync(db, user.id) }, { status: 201 });
    const run = await getRun(db, command.runId);
    if (!run) throw new ApiError(404, "Catalog sync not found.");
    if (run.status !== "staging") throw new ApiError(409, "Catalog sync is no longer staging.");
    let page;
    try {
      page = await fetchCatalogPage(run.next_page, token);
    } catch (error) {
      if (error instanceof CatalogSourceError && error.status === 429)
        return Response.json(
          { error: error.message },
          { status: 429, headers: { "Retry-After": String(error.retryAfter ?? 60) } },
        );
      throw new ApiError(503, "Source refresh failed validation or is unavailable. The published catalog is unchanged.");
    }
    try {
      const staged = await stagePage(db, user.id, {
        runId: run.id,
        page: run.next_page,
        total: page.pagination.total,
        more: page.pagination.hasMore,
        entries: page.data,
      });
      return Response.json({ run: staged });
    } catch (error) {
      if (error instanceof InvalidCatalog) throw new ApiError(422, error.message);
      throw error;
    }
  } catch (error) {
    return apiError(error);
  }
}
