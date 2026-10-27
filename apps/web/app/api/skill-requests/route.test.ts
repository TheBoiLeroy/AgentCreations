import { beforeEach, expect, it, vi } from "vitest";
const insert = vi.hoisted(() => vi.fn());
const cloud = vi.hoisted(() => ({ on: true }));
const saveLocalRequest = vi.hoisted(() => vi.fn(async () => 2));
vi.mock("../../../lib/server/local-requests", () => ({ saveLocalRequest }));
vi.mock("../../../lib/server/builds", async () => {
  const { z } = await import("zod");
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  return {
    ApiError,
    assertSameOrigin: (request: Request) => { if (request.headers.get("origin") !== "https://builder.test") throw new ApiError(403, "Forbidden"); },
    readBody: (request: Request) => request.json(),
    cloudConfigured: () => cloud.on,
    database: async () => ({ from: () => ({ insert }) }),
    apiError: (error: unknown) => Response.json({ error: "Failed" }, { status: error instanceof ApiError ? error.status : error instanceof z.ZodError ? 400 : 500 }),
  };
});
import { POST } from "./route";
const request = (body: unknown, origin = "https://builder.test") => new Request("https://builder.test/api/skill-requests", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { insert.mockReset(); insert.mockResolvedValue({ error: null }); cloud.on = true; saveLocalRequest.mockClear(); vi.unstubAllEnvs(); });
it("normalizes the term and never accepts a caller-supplied owner", async () => {
  expect((await POST(request({ term: " Calendar Sync " }))).status).toBe(200);
  expect(insert).toHaveBeenCalledWith({ search_term: "calendar sync" });
  expect((await POST(request({ term: "test", user_id: "another-owner" }))).status).toBe(400);
});
it("treats duplicate votes as success and other failures honestly", async () => {
  insert.mockResolvedValueOnce({ error: { code: "23505" } });
  expect((await POST(request({ term: "calendar" }))).status).toBe(200);
  insert.mockResolvedValueOnce({ error: { code: "missing-table" } });
  expect((await POST(request({ term: "calendar" }))).status).toBe(503);
});
it("rejects blank, oversized and cross-origin requests", async () => {
  expect((await POST(request({ term: " " }))).status).toBe(400);
  expect((await POST(request({ term: "x".repeat(201) }))).status).toBe(400);
  expect((await POST(request({ term: "calendar" }, "https://other.test"))).status).toBe(403);
  expect(insert).not.toHaveBeenCalled();
});
it("counts requests on this computer when cloud storage isn't configured in development", async () => {
  cloud.on = false;
  vi.stubEnv("NODE_ENV", "development");
  const response = await POST(request({ term: " Calendar Sync " }));
  expect(await response.json()).toEqual({ saved: true, where: "local", count: 2 });
  expect(saveLocalRequest).toHaveBeenCalledWith("calendar sync");
  expect(insert).not.toHaveBeenCalled();
});
it("doesn't fall back to a local file in production", async () => {
  cloud.on = false;
  vi.stubEnv("NODE_ENV", "production");
  expect((await POST(request({ term: "calendar" }))).status).toBe(503);
  expect(saveLocalRequest).not.toHaveBeenCalled();
});
