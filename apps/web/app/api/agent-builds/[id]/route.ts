import {
  apiError,
  assertSameOrigin,
  myBuild,
  readBody,
  saveBuild,
} from "../../../../lib/server/builds";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    return Response.json(await myBuild((await context.params).id), {
      headers: { "Cache-Control": "no-store" },
    });
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
