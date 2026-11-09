import { z } from "zod";
import { setupItemSchema, SETUP_MAX_ITEMS } from "@agents/spec/setups";
import { setupInstallScript } from "@agents/exporters";
import { ApiError } from "../../../../../lib/server/builds";
import { publishedSetups } from "../../../../../lib/server/setups";
import { siteOrigin } from "../../../../../lib/server/github";

type Context = { params: Promise<{ handle: string; slug: string }> };
// `curl -fsSL <this URL> -o setup.sh && sh setup.sh` installs the whole published setup.
export async function GET(request: Request, context: Context) {
  const text = (body: string, status = 200) =>
    new Response(body, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  try {
    const { handle, slug } = await context.params;
    const { profile, setup } = await publishedSetups({ handle, slug });
    if (!profile || !setup) throw new ApiError(404, "Setup not found.");
    // Stored items are re-validated before any of them reach a shell script.
    const items = z.array(setupItemSchema).max(SETUP_MAX_ITEMS).safeParse(setup.items);
    if (!items.success) return text("echo 'This setup has items this version of the site cannot read.' >&2\nexit 1\n", 422);
    const url = `${siteOrigin(request)}/u/${profile.handle}/${setup.slug}`;
    return text(setupInstallScript(items.data, { title: setup.title, handle: profile.handle, url }));
  } catch (error) {
    const missing = error instanceof ApiError || error instanceof z.ZodError;
    return text(`echo 'Setup not found.' >&2\nexit 1\n`, missing ? 404 : 500);
  }
}
