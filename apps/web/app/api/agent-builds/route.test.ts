import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GET, POST } from "./route";
import { emptyDraft } from "@agents/spec";
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_ANON_KEY", "");
});
describe("draft API boundaries", () => {
  it("reports device-only mode rather than inventing a successful cloud save", async () => {
    expect(await (await GET()).json()).toEqual({
      configured: false,
      builds: [],
    });
    const response = await POST(
      new Request("http://localhost/api/agent-builds", {
        method: "POST",
        body: JSON.stringify({ id, revision: 0, draft: emptyDraft }),
      }),
    );
    expect(response.status).toBe(503);
  });
  it("rejects unknown tools before touching storage", async () => {
    const response = await POST(
      new Request("http://localhost/api/agent-builds", {
        method: "POST",
        body: JSON.stringify({
          id,
          revision: 0,
          draft: { ...emptyDraft, selectedTools: ["shell-anything"] },
        }),
      }),
    );
    expect(response.status).toBe(400);
  });
  it("rejects an incomplete created agent", async () => {
    const response = await POST(
      new Request("http://localhost/api/agent-builds", {
        method: "POST",
        body: JSON.stringify({
          id,
          revision: 0,
          complete: true,
          draft: { ...emptyDraft, step: "install" },
        }),
      }),
    );
    expect(response.status).toBe(400);
  });
  it("rejects cross-origin writes and oversized requests", async () => {
    const response = await POST(
      new Request("http://localhost/api/agent-builds", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
    expect(
      (
        await POST(
          new Request("http://localhost/api/agent-builds", {
            method: "POST",
            body: "x".repeat(64001),
          }),
        )
      ).status,
    ).toBe(413);
  });
});
