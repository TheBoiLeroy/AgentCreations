import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDetails, emptyDraft, type BuildDraft } from "@agents/spec";
import {
  advise,
  createAgentSpec,
  matchesKeyword,
  recommendRules,
  type JevInput,
} from "./index";
const input: JevInput = {
  category: "information-analysis",
  inputChips: [],
  outputChips: [],
  context: "",
};
afterEach(() => vi.useRealTimers());
describe("Jev rules", () => {
  it("keeps every tool explicitly selected by chips with a reason", () => {
    const result = recommendRules({
      ...input,
      inputChips: ["spreadsheet"],
      outputChips: ["sent-email"],
    });
    expect(result.recommendations.map((r) => r.id)).toEqual([
      "read-files",
      "analyze-data",
      "send-email",
    ]);
    expect(
      result.recommendations.every(
        (r) => r.source === "chip" && r.confidence === 1 && r.reason,
      ),
    ).toBe(true);
  });
  it("uses full keyword and phrase matches, case-insensitively", () => {
    const result = recommendRules({
      ...input,
      context: "Please READ a PDF, draft a quote, and SEND EMAIL.",
    });
    expect(result.recommendations.map((r) => r.id)).toEqual(
      expect.arrayContaining(["read-files", "draft-text", "send-email"]),
    );
    expect(result.noticed).toContain("pdf");
    expect(matchesKeyword("Please send\nemail.", "send email")).toBe(true);
  });
  it.each([
    "profiles",
    "profile",
    "emailing",
    "voicemail",
    "webbing",
    "planets",
    "éemail",
    "emailé",
  ])("does not match partial words: %s", (context) => {
    expect(
      ["files", "file", "email", "web", "plan"].some((word) =>
        matchesKeyword(context, word),
      ),
    ).toBe(false);
  });
  it("falls back to the selected category and asks a question", () => {
    const result = recommendRules({
      ...input,
      category: "creation-communication",
      context: "Help me please",
    });
    expect(result.recommendations).toEqual([
      expect.objectContaining({ id: "draft-text", source: "default" }),
    ]);
    expect(result.followUp).toContain("connect");
  });
  it("rejects unknown chip IDs", () =>
    expect(() =>
      recommendRules({ ...input, inputChips: ["invented"] }),
    ).toThrow());
});
describe("optional model pass", () => {
  it("skips short text", async () => {
    const model = vi.fn();
    await advise({ ...input, context: "abc" }, model);
    expect(model).not.toHaveBeenCalled();
  });
  it("merges catalog-only picks without dropping chip picks", async () => {
    const result = await advise(
      {
        ...input,
        context: "Help with this work please",
        outputChips: ["sent-email"],
      },
      async () => ({
        picks: [
          {
            id: "review-content",
            reason: "Check the wording",
            confidence: 0.7,
          },
        ],
        followUp: "",
      }),
    );
    expect(result.mode).toBe("enhanced");
    expect(result.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "send-email", source: "chip" }),
        expect.objectContaining({ id: "review-content", source: "llm" }),
      ]),
    );
  });
  it.each([
    {
      picks: [{ id: "execute-arbitrary-code", reason: "oops", confidence: 1 }],
      followUp: "",
    },
    {
      picks: [{ id: "send-email", reason: "oops", confidence: 2 }],
      followUp: "",
    },
    "not json",
  ])("falls back on invalid output", async (output) => {
    const result = await advise(
      { ...input, context: "Write a proposal please" },
      async () => output,
    );
    expect(result.mode).toBe("fallback");
    expect(result.recommendations.some((r) => r.id === "draft-text")).toBe(
      true,
    );
  });
  it("falls back on provider failure", async () => {
    expect(
      (
        await advise(
          { ...input, context: "Write a proposal please" },
          async () => {
            throw new Error("provider error");
          },
        )
      ).mode,
    ).toBe("fallback");
  });
  it("aborts and falls back after eight seconds even if the provider ignores cancellation", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const promise = advise(
      { ...input, context: "Write a proposal please" },
      (_input, s) => {
        signal = s;
        return new Promise(() => {});
      },
    );
    await vi.advanceTimersByTimeAsync(8000);
    expect((await promise).mode).toBe("fallback");
    expect(signal?.aborted).toBe(true);
  });
});
const details = (patch: Partial<BuildDraft["details"]> = {}): BuildDraft["details"] => ({
  ...emptyDetails,
  inputs: [{ label: "Customer email thread", type: "text", formats: [], required: true }],
  template: "Reply draft",
  method: "1. Read the request\n2. Answer it",
  whenToUse: "Use when the user wants a reply drafted.",
  seeded: true,
  ...patch,
});
describe("spec creation", () => {
  it("takes approval requirements from the catalog and drops behavior-only tools", () => {
    const spec = createAgentSpec(
      {
        ...emptyDraft,
        category: "action-automation",
        name: "Mailer",
        inputChips: ["emails"],
        outputChips: ["sent-email"],
        selectedTools: ["send-email", "draft-text"],
        details: details({ skillAnswers: { recipient: "owner@example.com" } }),
      },
      "mailer",
    );
    expect(spec.tools).toEqual([{ id: "send-email", requiresApproval: true }]);
    expect(spec.needs.connections).toEqual(["Email"]);
    expect(spec.schemaVersion).toBe(3);
  });
  it("allows users to disable all tools", () => {
    const spec = createAgentSpec(
      {
        ...emptyDraft,
        category: "information-analysis",
        name: "Reader",
        context: "Read the text I supply",
        details: details(),
      },
      "reader",
    );
    expect(spec.tools).toEqual([]);
    expect(spec.instructions).not.toMatch(/ask for missing/i);
    expect(spec.instructions).toContain("List missing inputs and your assumptions");
  });
  it("throws the first follow-up question until it is answered", () => {
    expect(() =>
      createAgentSpec(
        { ...emptyDraft, category: "information-analysis", name: "Reader", context: "Read the text I supply", details: details({ method: "" }) },
        "reader",
      ),
    ).toThrow("Add the steps this agent should follow.");
  });
  it("auto-wires file readers from declared input formats", () => {
    const spec = createAgentSpec(
      {
        ...emptyDraft,
        category: "creation-communication",
        name: "Notes",
        context: "Summarize notes",
        details: details({ inputs: [{ label: "Board minutes", type: "file", formats: ["docx"], required: true }] }),
      },
      "notes",
    );
    expect(spec.tools.map((t) => t.id)).toEqual(["read-files", "extract-documents"]);
    expect(spec.inputs[0]).toEqual({ name: "boardMinutes", label: "Board minutes", type: "file", formats: ["docx"], required: true });
  });
  it.each(["extracted", "pdfkit", "excellent", "wordy documents"])(
    "does not recommend extract-documents for partial words: %s",
    (context) =>
      expect(recommendRules({ ...input, context }).recommendations.some((r) => r.id === "extract-documents")).toBe(false),
  );
});
