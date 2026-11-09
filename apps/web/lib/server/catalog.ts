import "server-only";
import { ApiError } from "./builds";
import { currentUser } from "./auth";
import { database } from "./store/db";
import { isMaintainer } from "./store/catalog";

/** A signed-in, non-anonymous account listed in catalog_maintainers. Added by an operator, never by the app. */
export async function maintainer() {
  const user = await currentUser();
  if (!user || user.kind === "anonymous") throw new ApiError(401, "Account authentication required.");
  const db = await database();
  if (!(await isMaintainer(db, user))) throw new ApiError(403, "Maintainer access required.");
  return { db, user };
}
