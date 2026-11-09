import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", async () => ({ cookies: async () => (await import("../../../lib/server/test-support")).cookieStore }));
import type { Client } from "@libsql/client";
import { POST } from "./route";
import { freshDatabase, post } from "../../../lib/server/test-support";

let db: Client;
beforeEach(async () => {
  db = await freshDatabase();
});
const send = (body: unknown, origin = "http://localhost") => POST(post("/api/skill-requests", body, { headers: { Origin: origin } }));
it("normalizes the term, counts one vote per browser and never accepts a caller-supplied owner", async () => {
  expect((await send({ term: " Calendar Sync " })).status).toBe(200);
  expect((await send({ term: "calendar sync" })).status).toBe(200);
  expect((await db.execute("select search_term from skill_requests")).rows.map((r) => r.search_term)).toEqual(["calendar sync"]);
  expect((await send({ term: "test", user_id: "another-owner" })).status).toBe(400);
});
it("rejects blank, oversized and cross-origin requests", async () => {
  expect((await send({ term: " " })).status).toBe(400);
  expect((await send({ term: "x".repeat(201) })).status).toBe(400);
  expect((await send({ term: "calendar" }, "https://other.test")).status).toBe(403);
  expect((await db.execute("select count(*) as n from skill_requests")).rows[0].n).toBe(0);
});
