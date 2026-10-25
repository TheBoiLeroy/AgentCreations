import { describe, expect, it, vi } from "vitest";
import {
  catalogEntrySchema,
  curationSchema,
  fetchCatalogPage,
} from "./skill-catalog";

const entry = {
  id: "anthropics/skills/pdf",
  source: "anthropics/skills",
  slug: "pdf",
  name: "PDF",
  installs: 1000,
  sourceType: "github",
  installUrl: "https://github.com/anthropics/skills",
  url: "https://skills.sh/anthropics/skills/pdf",
};
const validPage = {
  data: [entry],
  pagination: { page: 0, perPage: 500, total: 1, hasMore: false },
};
describe("skills.sh source adapter", () => {
  it("fetches only the fixed API with bounded cancellation and no user context", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(validPage));
    expect((await fetchCatalogPage(0, "test-token", fetcher)).data).toEqual([
      entry,
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://skills.sh/api/v1/skills?view=all-time&page=0&per_page=500",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-token" },
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it.each([
    { ...validPage, pagination: { ...validPage.pagination, total: 2 } },
    { ...validPage, pagination: { ...validPage.pagination, page: 1 } },
    { ...validPage, pagination: { ...validPage.pagination, hasMore: true } },
    {
      ...validPage,
      data: [entry, entry],
      pagination: { ...validPage.pagination, total: 2 },
    },
    { ...validPage, data: [] },
  ])("rejects incomplete, duplicated or inconsistent pages", async (body) => {
    await expect(
      fetchCatalogPage(
        0,
        "token",
        vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)),
      ),
    ).rejects.toThrow();
  });
  it.each([
    { ...entry, installUrl: "https://evil.example/install" },
    { ...entry, url: "javascript:alert(1)" },
    { ...entry, id: "somebody/else/pdf" },
    { ...entry, slug: "pdf;curl" },
  ])("rejects untrusted identities and links", (value) => {
    expect(catalogEntrySchema.safeParse(value).success).toBe(false);
  });
  it("preserves upstream rate-limit guidance without exposing response bodies", async () => {
    await expect(
      fetchCatalogPage(
        0,
        "secret",
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response("private details", {
              status: 429,
              headers: { "Retry-After": "120" },
            }),
          ),
      ),
    ).rejects.toMatchObject({ status: 429, retryAfter: 120 });
  });
  it("bounds actual response bytes", async () => {
    await expect(
      fetchCatalogPage(
        0,
        "token",
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("x".repeat(2000001))),
      ),
    ).rejects.toThrow("size limit");
  });
  it("requires a reason, expected revision and known requirement fields for curation", () => {
    expect(
      curationSchema.safeParse({
        target: entry.id,
        decision: "flagged",
        reason: "",
        requirements: {},
        revision: 0,
      }).success,
    ).toBe(false);
    expect(
      curationSchema.safeParse({
        target: entry.id,
        decision: "flagged",
        reason: "Evidence",
        requirements: { execute: true },
        revision: 0,
      }).success,
    ).toBe(false);
  });
});
