import { z } from "zod";
import {
  ApiError,
  apiError,
  assertSameOrigin,
  database,
  readBody,
  saveBuild,
} from "../../../../lib/server/builds";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const client = await database();
    const { data, error } = await client
      .from("agent_builds")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error || !data)
      throw new ApiError(404, "Build not found in this session.");
    return Response.json(data);
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    return Response.json(
      await saveBuild((await context.params).id, await readBody(request)),
    );
  } catch (error) {
    return apiError(error);
  }
}
