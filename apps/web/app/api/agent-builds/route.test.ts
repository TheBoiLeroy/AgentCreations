import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", async () => ({ cookies: async () => (await import("../../../lib/server/test-support")).cookieStore }));
import { emptyDraft } from "@agents/spec";
import { GET, POST } from "./route";
import { GET as getOne, PATCH } from "./[id]/route";
import { freshDatabase, jar, post } from "../../../lib/server/test-support";

const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const draft = { ...emptyDraft, category: "creation-communication" as const, name: "Quote Writer", step: "name" as const };
const context = { params: Promise.resolve({ id }) };
const patch = (body: unknown) => PATCH(new Request(`http://localhost/api/agent-builds/${id}`, { method: "PATCH", body: JSON.stringify(body) }), context);
beforeEach(async () => {
  await freshDatabase();
});
describe("draft API on local Turso storage", () => {
  it("creates an anonymous session on the first save and keeps drafts to that browser", async () => {
    expect(await (await GET()).json()).toEqual({ configured: true, builds: [] });
    const created = await POST(post("/api/agent-builds", { id, revision: 0, draft }));
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ id, revision: 1, trigger: "quote-writer" });
    expect(jar.get("ac_session")).toBeTruthy();
    expect((await patch({ revision: 1, draft: { ...draft, step: "needs" } })).status).toBe(200);
    expect(await (await getOne(new Request("http://localhost"), context)).json()).toMatchObject({ revision: 2, draft: { step: "needs" } });
    // A stale tab conflicts instead of overwriting.
    expect((await patch({ revision: 1, draft })).status).toBe(409);
    // Another browser (no cookie) sees nothing and can't write.
    jar.clear();
    expect(await (await GET()).json()).toEqual({ configured: true, builds: [] });
    expect((await getOne(new Request("http://localhost"), context)).status).toBe(401);
    expect((await patch({ revision: 2, draft })).status).toBe(401);
  });
  it("rejects unknown tools and cross-origin writes before touching storage", async () => {
    const bad = await POST(post("/api/agent-builds", { id, revision: 0, draft: { ...draft, selectedTools: ["invented-tool"] } }));
    expect(bad.status).toBe(400);
    const cross = await POST(post("/api/agent-builds", { id, revision: 0, draft }, { headers: { Origin: "https://evil.example" } }));
    expect(cross.status).toBe(403);
    expect(jar.size).toBe(0);
  });
});
