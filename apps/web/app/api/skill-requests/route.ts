import { z } from "zod";
import { apiError, ApiError, assertSameOrigin, cloudConfigured, database, readBody } from "../../../lib/server/builds";
import { saveLocalRequest } from "../../../lib/server/local-requests";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = z.object({ term: z.string().trim().min(1).max(200) }).strict().parse(await readBody(request));
    const term = body.term.toLowerCase();
    // Local development without Supabase: count requests in a file on this computer.
    if (!cloudConfigured()) {
      if (process.env.NODE_ENV === "production")
        throw new ApiError(503, "Skill requests need cloud storage. Configure Supabase to collect them.");
      const count = await saveLocalRequest(term);
      return Response.json({ saved: true, where: "local", count });
    }
    const client = await database(true);
    const { error } = await client.from("skill_requests").insert({ search_term: term });
    if (error && error.code !== "23505") throw new ApiError(503, "Could not save your request. Check the skill_requests migration.");
    return Response.json({ saved: true, where: "cloud" });
  } catch (error) {
    return apiError(error);
  }
}
