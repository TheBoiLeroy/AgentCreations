import { describe, expect, it } from "vitest";
import { advise, describeFromAnswers, describeRequest, propose, recommendFromAnswers, recommendRequest, typesafeModel, verifyCoverage, verifyFromAnswers, verifyRequest, type Answers } from "./index";
import { catalog } from "./catalog";

const n = (value: number) => ({ type: "noul" as const, noul: value });
const c = (value: string, probabilities: Record<string, number>) => ({ type: "choice" as const, choice: value, confidence: 0.7, probabilities });
const tools = (picked: Record<string, number>): Answers =>
  Object.fromEntries(catalog.map((tool) => [`tool:${tool.id}`, n(picked[tool.id] ?? 0.05)]));
const request = "Agent that will email me a 5 minute read about my current interests";
const answers: Answers = {
  ...tools({ "web-search": 0.91, "send-email": 0.88, "read-email": 0.3, "analyze-data": 0.69 }),
  "req:delivery": c("email", { conversation: 0.1, email: 0.9 }),
  "req:recipient": c("self", { self: 0.85, others: 0.1, none: 0.05 }),
  "req:trigger": c("weekly", { on_demand: 0.06, daily: 0.14, weekdays: 0, weekly: 0.8, monthly: 0 }),
  "req:research": n(0.59),
  category: c("information-analysis", { "information-analysis": 0.7, "creation-communication": 0.3 }),
};
describe("Jev on TypeSafe", () => {
  it("lowercases model ids and defaults to jev-latest", () => {
    expect(typesafeModel("Jev-1.14.0")).toBe("jev-1.14.0");
    expect(typesafeModel(undefined)).toBe("jev-latest");
  });
  it("asks one yes/no per catalog skill plus the requirement questions", () => {
    const body = recommendRequest({ category: "information-analysis", inputChips: [], outputChips: [], context: request });
    expect(Object.keys(body.questions).filter((id) => id.startsWith("tool:"))).toHaveLength(catalog.length);
    expect(body.questions["req:trigger"]).toMatchObject({ type: "choice" });
    expect(body.state).toMatchObject({ request });
  });
  it("picks only skills Jev is fairly sure of, and turns choices into assumed requirements", () => {
    const result = recommendFromAnswers(answers);
    expect(result.picks.map((p) => p.id)).toEqual(["web-search", "send-email"]);
    expect(result.picks[0].reason).toBe("Jev: 91% likely needed for this request.");
    expect(result.requirements).toEqual([
      { type: "delivery", value: "email", quote: "", origin: "assumed" },
      { type: "recipient", value: "self", quote: "", origin: "assumed" },
      { type: "trigger", value: "weekly", quote: "", origin: "assumed" },
    ]);
  });
  it("ignores unsure or contradictory answers", () => {
    const unsure = recommendFromAnswers({
      "req:delivery": c("conversation", { conversation: 0.55, email: 0.45 }),
      "req:recipient": c("self", { self: 0.9 }),
      "req:trigger": c("on_demand", { on_demand: 0.9 }),
    });
    expect(unsure).toEqual({ picks: [], followUp: "", requirements: [] });
  });
  it("merges into the skills step: rules keep the user's own words, Jev adds what they missed", async () => {
    const result = await advise({ category: "information-analysis", inputChips: [], outputChips: [], context: request }, async () => recommendFromAnswers(answers));
    expect(result.mode).toBe("enhanced");
    expect(result.recommendations.map((r) => r.id)).toEqual(expect.arrayContaining(["web-search", "send-email"]));
    expect(result.recommendations.map((r) => r.id)).not.toContain("read-email");
    // Even a confident Jev can't add mailbox access to an "email me" request.
    const eager = await advise({ category: "information-analysis", inputChips: [], outputChips: [], context: request }, async () =>
      recommendFromAnswers({ ...answers, "tool:read-email": n(0.95) }),
    );
    expect(eager.recommendations.map((r) => r.id)).not.toContain("read-email");
    // The rules quoted "email me"; Jev's assumption doesn't replace a stated requirement.
    expect(result.requirements.find((r) => r.type === "delivery")).toMatchObject({ origin: "stated", quote: "email me" });
  });
  it("drives the describe box: category and skills from Jev, text from rules", async () => {
    expect(Object.keys(describeRequest(request).questions)).toContain("category");
    const guess = describeFromAnswers(request, answers);
    expect(guess).toMatchObject({ category: "information-analysis", tools: ["web-search", "send-email"] });
    const { draft, mode } = await propose(request, async () => guess);
    expect(mode).toBe("enhanced");
    expect(draft.selectedTools).toEqual(expect.arrayContaining(["web-search", "send-email"]));
    expect(draft.name).toBe("Email 5 Minute");
  });
  it("checks coverage with one yes/no per requirement and suggests a fix for gaps", async () => {
    const reqs = [
      { id: "length", type: "length" as const, value: "1000-1200 words", quote: "5 minute read", origin: "stated" as const },
      { id: "trigger", type: "trigger" as const, value: "weekly", quote: "", origin: "assumed" as const },
    ];
    expect(Object.keys(verifyRequest(reqs, "agent text").questions)).toEqual(["covers:length", "covers:trigger"]);
    const report = await verifyCoverage(reqs, "agent text", async (payload) =>
      verifyFromAnswers(reqs, { "covers:length": n(0.2), "covers:trigger": n(0.9) }),
    );
    expect(report).toEqual({
      status: "checked",
      results: [
        {
          requirement_id: "length",
          covered: false,
          where: "",
          problem: "Jev found nothing in the agent that makes this happen (20% likely covered).",
          fix: "Only worker agents write to a length. Remove this requirement or the live-panel choice.",
        },
        { requirement_id: "trigger", covered: true, where: "", problem: "", fix: "" },
      ],
    });
  });
});
