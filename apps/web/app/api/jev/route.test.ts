import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { POST } from "./route";
const input = {
  category: "creation-communication",
  inputChips: [],
  outputChips: ["draft"],
  context: "Write a proposal from notes",
};
beforeEach(() => {
  vi.stubEnv("JEV_API_KEY", "");
  vi.stubEnv("TYPESAFE_API_KEY", "");
  vi.stubEnv("JEV_MODEL", "");
  vi.unstubAllGlobals();
});
describe("server-only Jev API", () => {
  it("returns rules without model credentials", async () => {
    const result = await POST(
      new Request("http://localhost/api/jev", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    expect(result.status).toBe(200);
    expect((await result.json()).recommendations).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "draft-text" })]),
    );
  });
  it("rejects unknown catalog chips and malformed JSON", async () => {
    for (const body of [
      "oops",
      JSON.stringify({ ...input, outputChips: ["invented"] }),
    ]) {
      expect(
        (
          await POST(
            new Request("http://localhost/api/jev", { method: "POST", body }),
          )
        ).status,
      ).toBe(400);
    }
  });
  it("drafts a whole agent from a description without model credentials", async () => {
    const post = (description: string) =>
      POST(new Request("http://localhost/api/jev", { method: "POST", body: JSON.stringify({ description }) }));
    const result = await post("Read my PDF contracts and summarize the risks");
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.mode).toBe("rules");
    expect(body.draft).toMatchObject({ step: "review", category: "information-analysis" });
    expect((await post("short")).status).toBe(400);
  });
  it("accepts the page's own origin even when the server reports another host name", async () => {
    const send = (origin: string) =>
      POST(
        new Request("http://localhost:3000/api/jev", {
          method: "POST",
          headers: { Origin: origin, Host: "127.0.0.1:3000" },
          body: JSON.stringify(input),
        }),
      );
    expect((await send("http://127.0.0.1:3000")).status).toBe(200);
    for (const origin of ["http://localhost:3000", "https://evil.example", "null"])
      expect((await send(origin)).status).toBe(403);
  });
  it("rejects cross-origin writes", async () => {
    expect(
      (
        await POST(
          new Request("http://localhost/api/jev", {
            method: "POST",
            headers: { Origin: "https://evil.example" },
            body: JSON.stringify(input),
          }),
        )
      ).status,
    ).toBe(403);
  });
});

describe("Jev via TypeSafe", () => {
  const typesafe = (answers: Record<string, unknown>, status = 200) =>
    vi.fn(async (_url: string, _init: RequestInit) => Response.json(status === 200 ? { model: "jev-1.14.0", answers } : { detail: "x" }, { status }));
  it("sends typed questions to TypeSafe with the key and a lowercase model", async () => {
    vi.stubEnv("JEV_API_KEY", "apikey_test");
    vi.stubEnv("JEV_MODEL", "Jev-1.14.0");
    const fetcher = typesafe({ "tool:draft-text": { type: "noul", noul: 0.9 } });
    vi.stubGlobal("fetch", fetcher);
    const result = await (await POST(new Request("http://localhost/api/jev", { method: "POST", body: JSON.stringify(input) }))).json();
    expect(result.mode).toBe("enhanced");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer apikey_test");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("jev-1.14.0");
    expect(body.questions["tool:draft-text"]).toMatchObject({ type: "noul" });
    expect(body.state).toMatchObject({ request: input.context });
  });
  it("falls back to rules when TypeSafe errors or answers malformed data", async () => {
    vi.stubEnv("JEV_API_KEY", "apikey_test");
    for (const fetcher of [typesafe({}, 401), vi.fn(async () => Response.json({ nonsense: true }))]) {
      vi.stubGlobal("fetch", fetcher);
      const result = await (await POST(new Request("http://localhost/api/jev", { method: "POST", body: JSON.stringify(input) }))).json();
      expect(result.mode).toBe("fallback");
      expect(result.recommendations).toEqual(expect.arrayContaining([expect.objectContaining({ id: "draft-text" })]));
    }
  });
});
