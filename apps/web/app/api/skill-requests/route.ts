import { z } from "zod";
import { apiError, assertSameOrigin, readBody } from "../../../lib/server/builds";
import { ensureUser } from "../../../lib/server/auth";
import { database } from "../../../lib/server/store/db";
import { addSkillRequest } from "../../../lib/server/store/builds";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = z.object({ term: z.string().trim().min(1).max(200) }).strict().parse(await readBody(request));
    const user = await ensureUser();
    await addSkillRequest(await database(), user.id, body.term.toLowerCase());
    return Response.json({ saved: true });
  } catch (error) {
    return apiError(error);
  }
}
