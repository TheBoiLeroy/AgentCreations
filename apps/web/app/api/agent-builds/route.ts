import { z } from "zod";
import {
  apiError,
  assertSameOrigin,
  cloudConfigured,
  database,
  readBody,
  saveBuild,
  saveSchema,
} from "../../../lib/server/builds";
export async function GET() {
  if (!cloudConfigured())
    return Response.json({ configured: false, builds: [] });
  try {
    const client = await database();
    const { data, error } = await client
      .from("agent_builds")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return Response.json({ configured: true, builds: data });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { id, ...body } = saveSchema
      .extend({ id: z.string().uuid() })
      .parse(await readBody(request));
    return Response.json(await saveBuild(id, body, true), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
