import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", async () => ({ cookies: async () => (await import("../../../../lib/server/test-support")).cookieStore }));
const fetchPage = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/skill-catalog", async (original) => ({
  ...(await original<typeof import("../../../../lib/skill-catalog")>()),
  fetchCatalogPage: fetchPage,
}));
import type { Client } from "@libsql/client";
import { GET, POST } from "./route";
import { CatalogSourceError } from "../../../../lib/skill-catalog";
import { freshDatabase, jar, post } from "../../../../lib/server/test-support";
import { createSession, createUser } from "../../../../lib/server/store/users";

let db: Client;
const send = (body: unknown, origin?: string) => POST(post("/api/catalog/manage", body, origin ? { headers: { origin } } : {}));
async function as(kind: "github" | "anonymous", maintainer: boolean) {
  const user = await createUser(db, kind, kind === "github" ? Math.floor(Math.random() * 1e6) + 1 : null);
  if (maintainer) await db.execute({ sql: "insert into catalog_maintainers values (?)", args: [user.id] });
  jar.set("ac_session", (await createSession(db, user.id)).token);
}
const entry = { id: "owner/repo/one", slug: "one", source: "owner/repo", name: "one", installs: 1, sourceType: "github", installUrl: null, url: "https://skills.sh/owner/repo/one" };
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_OIDC_TOKEN", "test-oidc");
  db = await freshDatabase();
});
describe("catalog management", () => {
  it("requires a non-anonymous maintainer and same-origin writes", async () => {
    expect((await send({ action: "start" })).status).toBe(401);
    await as("anonymous", true);
    expect((await send({ action: "start" })).status).toBe(401);
    await as("github", false);
    expect((await send({ action: "start" })).status).toBe(403);
    expect((await GET()).status).toBe(403);
    await as("github", true);
    expect((await send({ action: "start" }, "https://evil.example")).status).toBe(403);
  });
  it("starts, stages and publishes, reading the source token from the server only", async () => {
    await as("github", true);
    const start = await send({ action: "start" });
    expect(start.status).toBe(201);
    const { run } = await start.json();
    fetchPage.mockResolvedValue({ data: [entry], pagination: { page: 0, perPage: 500, total: 1, hasMore: false } });
    const advanced = await send({ action: "advance", runId: run.id });
    expect(await advanced.json()).toMatchObject({ run: { status: "published", expected_total: 1 } });
    expect(fetchPage).toHaveBeenCalledWith(0, "test-oidc");
    expect((await send({ action: "advance", runId: run.id })).status).toBe(409);
    expect((await (await GET()).json()).runs).toHaveLength(1);
  });
  it("passes rate limits through and leaves the run untouched on source errors", async () => {
    await as("github", true);
    const { run } = await (await send({ action: "start" })).json();
    fetchPage.mockRejectedValueOnce(new CatalogSourceError(429, 30));
    const limited = await send({ action: "advance", runId: run.id });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("30");
    fetchPage.mockRejectedValueOnce(new Error("bad"));
    expect((await send({ action: "advance", runId: run.id })).status).toBe(503);
    expect((await db.execute("select next_page from catalog_runs")).rows[0].next_page).toBe(0);
  });
  it("needs the source token for syncs but not for curation", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    await as("github", true);
    expect((await send({ action: "start" })).status).toBe(503);
    const change = { target: "anthropics/skills/pdf", decision: "flagged", reason: "Review", requirements: {}, revision: 0 };
    expect(await (await send({ action: "curate", change })).json()).toMatchObject({ override: { revision: 1 } });
    expect((await send({ action: "curate", change })).status).toBe(409);
  });
});
