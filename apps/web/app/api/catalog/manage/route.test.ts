import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  fetchPage: vi.fn(),
}));
vi.mock("../../../../lib/server/catalog", async (original) => ({
  ...(await original<typeof import("../../../../lib/server/catalog")>()),
  maintainerDatabase: mocks.authorize,
}));
vi.mock("../../../../lib/skill-catalog", async (original) => ({
  ...(await original<typeof import("../../../../lib/skill-catalog")>()),
  fetchCatalogPage: mocks.fetchPage,
}));
import { POST } from "./route";
import { ApiError } from "../../../../lib/server/builds";
import { CatalogSourceError } from "../../../../lib/skill-catalog";
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
function request(body: unknown, origin?: string) {
  return new Request("http://localhost/api/catalog/manage", {
    method: "POST",
    body: JSON.stringify(body),
    headers: origin ? { origin } : {},
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_OIDC_TOKEN", "test-oidc");
  mocks.authorize.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from });
  mocks.rpc.mockResolvedValue({ data: { id }, error: null });
  mocks.from.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { id, status: "staging", next_page: 0 },
          error: null,
        }),
      }),
    }),
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("catalog management API", () => {
  it("rejects non-maintainers before contacting the source or writing", async () => {
    mocks.authorize.mockRejectedValue(new ApiError(403, "Maintainer required"));
    expect((await POST(request({ action: "start" }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.fetchPage).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes before authentication", async () => {
    expect(
      (await POST(request({ action: "start" }, "https://evil.example"))).status,
    ).toBe(403);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it("reports missing source authentication without creating a sync", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    expect((await POST(request({ action: "start" }))).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not stage or publish when source validation fails", async () => {
    mocks.fetchPage.mockRejectedValue(new Error("private upstream error"));
    const response = await POST(request({ action: "advance", runId: id }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private upstream error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("propagates retry guidance and leaves the page resumable", async () => {
    mocks.fetchPage.mockRejectedValue(new CatalogSourceError(429, 90));
    const response = await POST(request({ action: "advance", runId: id }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("90");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("stages only validated pages using the stored page number", async () => {
    mocks.fetchPage.mockResolvedValue({
      data: [],
      pagination: { total: 1, hasMore: false },
    });
    expect((await POST(request({ action: "advance", runId: id }))).status).toBe(
      200,
    );
    expect(mocks.fetchPage).toHaveBeenCalledWith(0, "test-oidc");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "stage_catalog_page",
      expect.objectContaining({ p_run: id, p_page: 0 }),
    );
  });
  it("allows curation without an upstream token and rejects stale revisions", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40001" } });
    const response = await POST(
      request({
        action: "curate",
        change: {
          target: "anthropics/skills/pdf",
          decision: "flagged",
          reason: "Review needed",
          requirements: {},
          revision: 1,
        },
      }),
    );
    expect(response.status).toBe(409);
    expect(mocks.fetchPage).not.toHaveBeenCalled();
  });
});
