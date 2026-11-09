import { describe, expect, it } from "vitest";
import { specProblems } from "@agents/spec";
import { exportProblems } from "@agents/exporters";
import { createAgentSpec, nameFromDescription, pendingQuestions, propose, proposeRules } from "./index";

const model = (patch: Record<string, unknown> = {}) => ({
  name: "Contract Reader",
  category: "information-analysis",
  inputChips: ["files"],
  outputChips: ["summary"],
  tools: ["extract-documents"],
  inputs: [
    { label: "Notes about the deal", type: "text", formats: [], required: false },
    { label: "Signed contracts", type: "folder", formats: [], required: true },
  ],
  sections: ["Risks", "Deadlines"],
  method: ["Read each contract.", "Ask the user which clauses matter.", "List the risks."],
  whenToUse: "Use when the user wants contract risks summarized.",
  topics: "",
  ...patch,
});
describe("describe-to-create proposals", () => {
  it("names the agent from the job, not the request wrapper", () => {
    expect(nameFromDescription("I want an agent that reads my customer emails and drafts quotes")).toBe("Reads Customer Emails");
    expect(nameFromDescription("research AI news and email me a summary")).toBe("Research AI News");
    expect(nameFromDescription("???? !!!!")).toBe("New helper");
  });
  it("turns one sentence into a draft that creates a spec with no export problems", () => {
    const { draft, mode } = proposeRules("Read my PDF contracts and summarize the risks");
    expect(mode).toBe("rules");
    expect(draft).toMatchObject({ step: "review", category: "information-analysis", inputChips: ["files"], outputChips: ["summary"] });
    expect(pendingQuestions(draft)).toEqual([]);
    const spec = createAgentSpec(draft, "read-pdf-contracts");
    expect(specProblems(spec)).toEqual([]);
    expect(exportProblems(spec, "Pi")).toEqual([]);
    expect(spec.inputs.map((x) => x.type)).toEqual(["folder", "text"]);
    // Every default is shown to the user.
    expect(draft.assumed.join("\n")).toContain("Files to work from");
    expect(draft.assumed.join("\n")).toContain("Findings");
    // A keyword alone suggests an external skill without switching it on.
    expect(draft.recommendations.map((r) => r.id)).toContain("skill-pdf");
    expect(draft.selectedTools).not.toContain("skill-pdf");
    expect(draft.assumed.join("\n")).toContain("Work with PDFs");
    expect(proposeRules("Turn my notes into a slide deck").draft.selectedTools).toContain("skill-presentations");
  });
  it("does not claim the user clicked a chip", () => {
    const { draft } = proposeRules("Read my PDF contracts and summarize the risks");
    expect(draft.recommendations.map((r) => r.reason).join(" ")).not.toContain("You chose");
  });
  it("keeps the two skill questions open instead of inventing answers", () => {
    const { draft } = proposeRules("research a topic and email me");
    expect(draft.step).toBe("details");
    expect(pendingQuestions(draft).map((q) => q.field).sort()).toEqual(["skillAnswers.recipient", "skillAnswers.topics"]);
    const withAddress = proposeRules("research battery recycling and email me at owner@example.com").draft;
    expect(withAddress.details.skillAnswers).toEqual({ recipient: "owner@example.com" });
  });
  it("proposes a live extension for a running-agents panel", () => {
    const { draft } = proposeRules("an agent showing me the current agents running in the terminal");
    expect(draft.step).toBe("review");
    const spec = createAgentSpec(draft, "agents");
    expect(spec.runtime).toBe("extension");
    expect(spec.dataSources).toEqual(["session-events", "process-list"]);
    expect(specProblems(spec)).toEqual([]);
  });
  it("lets the agent ask when the description says to ask", () => {
    const { draft } = proposeRules("Write a friendly quote from my notes. Ask me before sending anything.");
    expect(draft.details.conversation).toBe("followUp");
    expect(specProblems(createAgentSpec(draft, "quote"))).toEqual([]);
  });
  it("matches whole words only", () => {
    const { draft } = proposeRules("Help me deliver corporate filename conventions");
    expect(draft.inputChips).toEqual([]);
    expect(draft.outputChips).toEqual([]);
  });
  it("merges a valid model pass: required inputs first, formats filled, asking steps removed", async () => {
    const { draft, mode } = await propose("Read my PDF contracts and summarize the risks", async () => model());
    expect(mode).toBe("enhanced");
    expect(draft.name).toBe("Contract Reader");
    expect(draft.details.inputs).toEqual([
      { label: "Signed contracts", type: "folder", formats: ["pdf", "docx", "md", "txt"], required: true },
      { label: "Notes about the deal", type: "text", formats: [], required: false },
    ]);
    expect(draft.details.template).toBe("Risks\nDeadlines");
    expect(draft.details.method).toBe("1. Read each contract.\n2. List the risks.");
    expect(draft.selectedTools).toEqual(expect.arrayContaining(["read-files", "extract-documents"]));
    expect(specProblems(createAgentSpec(draft, "contract-reader"))).toEqual([]);
  });
  it("never takes a recipient from the model", async () => {
    const { draft } = await propose("research a topic and email me", async () =>
      model({ tools: ["web-search", "send-email"], inputChips: [], outputChips: ["sent-email"], topics: "Battery recycling" }),
    );
    expect(draft.details.skillAnswers).toEqual({ topics: "Battery recycling" });
    expect(draft.step).toBe("details");
  });
  it("falls back to rules on invented ids, placeholders, errors and timeouts", async () => {
    const text = "Read my PDF contracts and summarize the risks";
    const rules = proposeRules(text).draft;
    for (const llm of [
      async () => model({ tools: ["launch-rocket"] }),
      async () => model({ extra: true }),
      async () => { throw new Error("down"); },
    ])
      expect(await propose(text, llm)).toEqual({ draft: rules, mode: "fallback" });
    expect((await propose(text, () => new Promise(() => {}), 10)).mode).toBe("fallback");
    const placeholder = await propose(text, async () =>
      model({ inputs: [{ label: "Files & documents", type: "folder", formats: ["pdf"], required: true }] }),
    );
    expect(placeholder.draft.details.inputs.map((x) => x.label)).toEqual(["Files to work from", "Details for this run"]);
  });
});
