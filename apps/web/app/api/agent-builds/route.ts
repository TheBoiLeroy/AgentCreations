import { z } from "zod";
import {
  apiError,
  assertSameOrigin,
  myBuilds,
  readBody,
  saveBuild,
  saveSchema,
} from "../../../lib/server/builds";
export async function GET() {
  try {
    return Response.json(
      { configured: true, builds: await myBuilds() },
      { headers: { "Cache-Control": "no-store" } },
    );
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
