import { apiError, assertSameOrigin, readBody } from "../../../lib/server/builds";
import { createSetup, publishedSetups } from "../../../lib/server/setups";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    return Response.json(
      await publishedSetups({
        handle: params.get("handle") || undefined,
        slug: params.get("slug") || undefined,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json(await createSetup(await readBody(request)), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
