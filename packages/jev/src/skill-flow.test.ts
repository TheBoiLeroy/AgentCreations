import { describe, expect, it } from "vitest";
import { emptyDraft, mergeSkillInputs, skillRecordSchema, specProblems, type BuildDraft } from "@agents/spec";
import { exportProblems, piPackage } from "@agents/exporters";
import { catalog, classifyRuntime, createAgentSpec, detailsFromSpec, isVagueWhenToUse, pendingQuestions, recommendRules, skillQuestions, suggestDetails } from "./index";
const draft: BuildDraft = {
  ...emptyDraft, category: "information-analysis", name: "Research Mailer",
  context: "research a topic and email me", selectedTools: ["web-search", "send-email"],
  details: { ...emptyDraft.details, skillAnswers: { topics: "Battery recycling", recipient: "owner@example.com" } },
};
describe("skill-driven research mailer", () => {
  it("migrates every catalog entry to the metadata contract without asserting successful runs", () => {
    for (const skill of catalog) {
      const { keywords, requiresApproval, connection, ...record } = skill;
      expect(skillRecordSchema.safeParse(record).success).toBe(true);
      expect(record.tested).toBe(false);
    }
  });
  it("recommends research and sending, not reading a mailbox, from the description", () => {
    expect(recommendRules({ category: draft.category!, context: draft.context, inputChips: [], outputChips: [] }).recommendations.map((r) => r.id)).toEqual(["web-search", "send-email"]);
  });
  it("asks only two plain-language questions and deduplicates selected skills", () => {
    expect(skillQuestions({ selectedTools: ["web-search", "send-email", "web-search"] }).map((q) => q.id)).toEqual(["topics", "recipient"]);
    expect(pendingQuestions({ ...draft, details: { ...draft.details, skillAnswers: {} } }).map((q) => q.question)).toEqual(["What topics should it research?", "Which email should it send to?"]);
    expect(pendingQuestions(draft)).toEqual([]);
  });
  it("rejects conflicting duplicate questions", () => {
    const inputs = skillQuestions(draft);
    expect(() => mergeSkillInputs([{ inputs }, { inputs: [{ ...inputs[0], type: "email" }] }])).toThrow("Conflicting");
  });
  it("validates recipients and blocks incompatible runtime overrides before export", () => {
    expect(pendingQuestions({ ...draft, details: { ...draft.details, skillAnswers: { topics: "Batteries", recipient: "not-an-email" } } })[0].field).toBe("skillAnswers.recipient");
    expect(() => createAgentSpec({ ...draft, details: { ...draft.details, runtime: "extension" } }, "mailer")).toThrow("worker");
  });
  it("selects worker over live wording when skills need a model", () => {
    expect(classifyRuntime({ ...draft, context: "monitor research and email me", outputChips: ["live-panel"] }).runtime).toBe("worker");
    expect(classifyRuntime({ ...draft, selectedTools: [], context: "watch Pi sessions", outputChips: ["live-panel"] }).runtime).toBe("extension");
  });
  it("exports answers with no technical questions, preserving them on reopen", () => {
    const spec = createAgentSpec(draft, "research-mailer");
    expect(spec.runtime).toBe("worker");
    expect(spec.instructions).toContain("Battery recycling");
    expect(specProblems(spec)).toEqual([]);
    expect(detailsFromSpec(spec).skillAnswers).toEqual(draft.details.skillAnswers);
    expect(spec.tools.find((t) => t.id === "send-email")?.requiresApproval).toBe(true);
  });
  it("writes a research method, a real trigger and optional configured inputs", () => {
    const spec = createAgentSpec(draft, "research-mailer");
    expect(spec.method[0]).toContain("Search the web");
    expect(spec.method.join(" ")).not.toContain("Calculate totals");
    expect(spec.skill.whenToUse).toBe("Use when the user asks to research a topic and email me, or runs Research Mailer.");
    expect(spec.output.template).toEqual(["Findings", "Sources", "Proposed email", "Assumptions"]);
    expect(spec.inputs.every((input) => !input.required)).toBe(true);
    expect(spec.instructions).toContain("- Email recipient: owner@example.com");
    expect(spec.instructions).not.toContain("{");
  });
  it("exports the research mailer to Pi with search and approved email", () => {
    const spec = createAgentSpec(draft, "research-mailer");
    expect(exportProblems(spec, "Pi")).toEqual([]);
    const files = piPackage(spec);
    expect(JSON.parse(files["worker.json"]).actions).toEqual(["send-email"]);
    expect(files).toHaveProperty("tools/web.ts");
  });
  it("rejects a vague 'when to use' answer", () => {
    for (const value of ["never", "N/A", "always", "idk"]) expect(isVagueWhenToUse(value)).toBe(true);
    expect(isVagueWhenToUse("Use when I ask for a news digest")).toBe(false);
    const plain = { ...emptyDraft, category: "creation-communication" as const, name: "Notes", context: "summarize meeting notes", selectedTools: ["draft-text"] };
    const details = { ...suggestDetails(plain), inputs: [{ label: "Meeting notes", type: "text" as const, formats: [], required: true }], template: "Summary", whenToUse: "never" };
    expect(pendingQuestions({ ...plain, details }).map((q) => q.field)).toContain("whenToUse");
  });
});
