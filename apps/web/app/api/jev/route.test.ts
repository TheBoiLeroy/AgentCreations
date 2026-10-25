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
  vi.stubEnv("JEV_MODEL", "");
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
