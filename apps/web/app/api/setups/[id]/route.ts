import { apiError, assertSameOrigin, readBody } from "../../../../lib/server/builds";
import { deleteSetup, updateSetup } from "../../../../lib/server/setups";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    return Response.json(await updateSetup((await context.params).id, await readBody(request)));
  } catch (error) {
    return apiError(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    await deleteSetup((await context.params).id);
    return Response.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
