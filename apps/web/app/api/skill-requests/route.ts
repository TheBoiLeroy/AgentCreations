import { z } from "zod";
import { apiError, ApiError, assertSameOrigin, database, readBody } from "../../../lib/server/builds";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = z.object({ term: z.string().trim().min(1).max(200) }).strict().parse(await readBody(request));
    const client = await database(true);
    const { error } = await client.from("skill_requests").insert({ search_term: body.term.toLowerCase() });
    if (error && error.code !== "23505") throw new ApiError(503, "Could not save your request. Check the skill_requests migration.");
    return Response.json({ saved: true });
  } catch (error) {
    return apiError(error);
  }
}
