// Regression fixtures: the two original form inputs whose exported agents failed.
// Each must either produce the expected spec or stop with the listed error.
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { emptyDraft, specProblems, type AgentSpec, type BuildDraft } from "@agents/spec";
import { ExportError, exportProblems, piPackage, type Files } from "@agents/exporters";
import {
  classifyRuntime,
  createAgentSpec,
  pendingQuestions,
  recommendRules,
  suggestDetails,
} from "./index";

function form(patch: Partial<BuildDraft>): BuildDraft {
  const draft = { ...emptyDraft, ...patch };
  const picks = recommendRules({
    category: draft.category!,
    inputChips: draft.inputChips,
    outputChips: draft.outputChips,
    context: draft.context,
  });
  return { ...draft, selectedTools: picks.recommendations.map((r) => r.id) };
}
/** What the builder does when the user reaches the follow-up page. */
const seeded = (draft: BuildDraft): BuildDraft => ({ ...draft, details: suggestDetails(draft) });

const trackerForm = form({
  category: "support-oversight",
  name: "Agent Tracker",
  context: "Track the agents running on my machine and what they are doing, and give a UI in the CLI.",
  outputChips: ["interface"],
});
const estimatesForm = form({
  category: "information-analysis",
  name: "Estimates",
  context: "Look at my previous plans and estimates and generate an estimate for a new job.",
  inputChips: ["files"],
  outputChips: ["summary"],
});

describe("Agent Tracker regression", () => {
  it("does not classify model-dependent design skills as a live extension", () =>
    expect(classifyRuntime(trackerForm)).toMatchObject({ runtime: "worker", conflict: false }));
  it("stops when there is no data source", () => {
    expect(() => createAgentSpec({ ...trackerForm, selectedTools: [] }, "agent-tracker")).toThrow(
      "Where should this agent get its live data?",
    );
  });
  it("stops if it would come out as a worker without a data source", () => {
    const worker = seeded({ ...trackerForm, details: { ...trackerForm.details, runtime: "worker" } });
    const answered: BuildDraft = {
      ...worker,
      details: {
        ...worker.details,
        inputs: [{ label: "Question about agents", type: "text", formats: [], required: true }],
        template: "Agents",
        whenToUse: "Use when the user asks which agents are running.",
      },
    };
    const spec = createAgentSpec(answered, "agent-tracker");
    expect(specProblems(spec).map((p) => p.message)).toContain(
      "Where should this agent get its live data?",
    );
  });
  it("produces a live spec without model skills; imported incompatible specs still fail export", () => {
    const spec = createAgentSpec(seeded({ ...trackerForm, selectedTools: [] }), "agent-tracker");
    expect(spec).toMatchObject({
      runtime: "extension",
      dataSources: ["session-events", "process-list"],
      output: { kind: "widget" },
      inputs: [],
    });
    expect(specProblems(spec)).toEqual([]);
    const incompatible = { ...spec, tools: [{ id: "skill-frontend-design", requiresApproval: true, skillSource: { repository: "anthropics/skills", skill: "frontend-design" } }] };
    expect(exportProblems(incompatible, "Pi").map((p) => p.message)).toEqual([
      "`skill-frontend-design` isn't a tool this exporter can supply. External skills can't be bundled into a Pi worker; remove it and install the skill yourself if you need it.",
    ]);
    expect(() => piPackage(incompatible)).toThrow(ExportError);
  });
  it("exports a no-argument toggle extension once the skill is switched off", () => {
    const draft = seeded({ ...trackerForm, selectedTools: [] });
    const files = piPackage(createAgentSpec(draft, "agent-tracker"));
    expect(files["extensions/agent.ts"]).toContain("no arguments toggles");
    expect(files).not.toHaveProperty("worker.json");
    generated.push(["agent-tracker", files]);
  });
});

describe("Estimates regression", () => {
  it("classifies the task as a one-shot worker and recommends calculation", () => {
    expect(classifyRuntime(estimatesForm)).toMatchObject({ runtime: "worker", conflict: false });
    expect(estimatesForm.selectedTools).toEqual(expect.arrayContaining(["read-files", "analyze-data"]));
  });
  it("asks follow-up questions instead of passing placeholder text through", () => {
    expect(() => createAgentSpec(estimatesForm, "estimates")).toThrow(
      "What does this agent start with?",
    );
    const questions = pendingQuestions(seeded(estimatesForm)).map((q) => q.field);
    expect(questions).toEqual(["inputs.0.label", "inputs.1.label", "whenToUse"]);
    expect(seeded(estimatesForm).details.method).toContain("per-unit rates");
  });
  const answered = (): BuildDraft => {
    const draft = seeded(estimatesForm);
    return {
      ...draft,
      details: {
        ...draft.details,
        inputs: [
          { ...draft.details.inputs[0], label: "Past estimates", formats: ["pdf", "xlsx"] },
          { ...draft.details.inputs[1], label: "New job" },
        ],
        whenToUse: "Use when the user wants a cost estimate for a new job based on past estimates.",
      },
    };
  };
  it("produces the worker spec with typed inputs, method and output template", () => {
    const spec = createAgentSpec(answered(), "estimates");
    expect(spec).toMatchObject({
      runtime: "worker",
      conversation: "oneShot",
      inputs: [
        { name: "pastEstimates", type: "folder", formats: ["pdf", "xlsx"], required: true },
        { name: "newJob", type: "text", required: true },
      ],
      output: { kind: "chat-message", template: ["Line items", "Assumptions", "Past jobs used", "Confidence range"] },
    });
    expect(spec.tools.map((t) => t.id).sort()).toEqual(["analyze-data", "extract-documents", "read-files"]);
    expect(spec.method).toHaveLength(5);
    expect(specProblems(spec)).toEqual([]);
    const files = piPackage(spec);
    expect(JSON.parse(files["worker.json"])).toEqual({
      tools: ["read", "grep", "find", "ls", "calc", "extract_document"],
      extensions: ["tools/calc.ts", "tools/extract.ts"],
      actions: [],
    });
    expect(files["instructions.md"]).not.toContain("draft-text");
    expect(files["README.md"]).toContain('/estimates ./past-estimates "New job"');
    generated.push(["estimates", files]);
  });
  it("must fail without calc, without document extraction or without a method", () => {
    const spec = createAgentSpec(answered(), "estimates");
    const without = (id: string): AgentSpec => ({ ...spec, tools: spec.tools.filter((t) => t.id !== id) });
    expect(exportProblems(without("extract-documents"), "Pi").map((p) => p.message)).toEqual([
      "Add `extract-documents` to read `pdf` files.",
      "Add `extract-documents` to read `xlsx` files.",
    ]);
    expect(piPackage(without("analyze-data"))).not.toHaveProperty("tools/calc.ts");
    expect(exportProblems({ ...spec, method: [] }, "Pi").map((p) => p.message)).toContain(
      "Add the steps this agent should follow.",
    );
  });
});

// Typecheck each generated package against @earendil-works/pi-coding-agent, as the builder's self-test would.
const generated: [string, Files][] = [];
const root = join(dirname(fileURLToPath(import.meta.url)), "../../pi-runner/.typecheck");
afterAll(() => rmSync(root, { recursive: true, force: true }));
describe("generated packages", () => {
  it("typecheck against the Pi extension API", () => {
    expect(generated.map(([name]) => name).sort()).toEqual(["agent-tracker", "estimates"]);
    const entries: string[] = [];
    for (const [name, files] of generated)
      for (const [path, contents] of Object.entries(files)) {
        const target = join(root, name, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, contents);
        if (path.endsWith(".ts")) entries.push(target);
      }
    const program = ts.createProgram(entries, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: ["node"],
    });
    const errors = ts
      .getPreEmitDiagnostics(program)
      .map((d) => `${d.file?.fileName}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
    expect(errors).toEqual([]);
  }, 60000);
});
