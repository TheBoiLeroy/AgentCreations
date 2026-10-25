import { z } from "zod";
import {
  ApiError,
  apiError,
  assertSameOrigin,
  readBody,
} from "../../../../lib/server/builds";
import {
  maintainerDatabase,
  catalogDatabaseError,
} from "../../../../lib/server/catalog";
import {
  CatalogSourceError,
  curationSchema,
  fetchCatalogPage,
} from "../../../../lib/skill-catalog";

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }).strict(),
  z.object({ action: z.literal("advance"), runId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("curate"), change: curationSchema }).strict(),
]);

export async function GET(request: Request) {
  try {
    const client = await maintainerDatabase(request);
    const { data, error } = await client
      .from("catalog_runs")
      .select("id,status,next_page,expected_total,started_at,published_at")
      .order("started_at", { ascending: false })
      .limit(20);
    catalogDatabaseError(error);
    return Response.json(
      { runs: data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const client = await maintainerDatabase(request);
    const command = commandSchema.parse(await readBody(request));
    if (command.action === "curate") {
      const c = command.change;
      const { data, error } = await client.rpc("curate_catalog", {
        p_target: c.target,
        p_decision: c.decision,
        p_reason: c.reason,
        p_requirements: c.requirements,
        p_revision: c.revision,
      });
      catalogDatabaseError(error);
      return Response.json({ override: data });
    }
    // Read fresh on every request. Never accept a source token in browser input.
    const token = process.env.VERCEL_OIDC_TOKEN;
    if (!token)
      throw new ApiError(
        503,
        "Live catalog refresh is unavailable: Vercel OIDC is not configured.",
      );
    if (command.action === "start") {
      const { data, error } = await client.rpc("start_catalog_sync");
      catalogDatabaseError(error);
      return Response.json({ run: data }, { status: 201 });
    }
    const { data: run, error: readError } = await client
      .from("catalog_runs")
      .select("id,status,next_page,expected_total")
      .eq("id", command.runId)
      .maybeSingle();
    catalogDatabaseError(readError);
    if (!run) throw new ApiError(404, "Catalog sync not found.");
    if (run.status !== "staging")
      throw new ApiError(409, "Catalog sync is no longer staging.");
    let page;
    try {
      page = await fetchCatalogPage(run.next_page, token);
    } catch (error) {
      if (error instanceof CatalogSourceError && error.status === 429)
        return Response.json(
          { error: error.message },
          {
            status: 429,
            headers: { "Retry-After": String(error.retryAfter ?? 60) },
          },
        );
      throw new ApiError(
        503,
        "Source refresh failed validation or is unavailable. The published catalog is unchanged.",
      );
    }
    const { data, error } = await client.rpc("stage_catalog_page", {
      p_run: run.id,
      p_page: run.next_page,
      p_total: page.pagination.total,
      p_more: page.pagination.hasMore,
      p_entries: page.data,
    });
    catalogDatabaseError(error);
    return Response.json({ run: data });
  } catch (error) {
    return apiError(error);
  }
}
