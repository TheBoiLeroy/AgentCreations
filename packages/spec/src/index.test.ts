import { describe, expect, it } from "vitest";
import {
  agentSchema,
  draftSchema,
  emptyDetails,
  exampleAgent,
  isPlaceholder,
  parseAgentSpec,
  specProblems,
  type AgentSpec,
  triggerFromName,
  uniqueTrigger,
} from "./index";
describe("automatic triggers", () => {
  it.each([
    ["Quote Writer", "quote-writer"],
    ["  Café & Résumé!  ", "cafe-resume"],
    ["a---b", "a-b"],
    ["", "agent"],
    ["🤖", "agent"],
    ["中文", "agent"],
    ["123 Agent", "123-agent"],
  ])("normalizes %s", (name, expected) =>
    expect(triggerFromName(name)).toBe(expected),
  );
  it("suffixes collisions deterministically", () =>
    expect(
      uniqueTrigger("Quote Writer", [
        "quote-writer",
        "quote-writer-2",
        "quote-writer-3",
      ]),
    ).toBe("quote-writer-4"));
  it("keeps long names valid when suffixes are added", () => {
    const name = "Long agent name ".repeat(10),
      first = triggerFromName(name),
      second = uniqueTrigger(name, [first]);
    expect(first.length).toBeLessThanOrEqual(64);
    expect(second.length).toBeLessThanOrEqual(64);
    expect(second).toMatch(/-2$/);
    expect(second).not.toContain("--");
  });
  it("requires trigger and slug to match", () =>
    expect(
      agentSchema.safeParse({ ...exampleAgent, trigger: "different" }).success,
    ).toBe(false));
});
const v2 = () => {
  const { runtime, inputs, method, dataSources, conversation, skill, ...rest } =
    exampleAgent;
  const { kind, template, ...output } = exampleAgent.output;
  return { ...rest, output, schemaVersion: 2 as const };
};
describe("backward compatibility", () => {
  it("migrates v1 without changing its instructions or trigger", () => {
    const { trigger, tools, ...old } = v2();
    const { inputChips, outputChips, context, ...needs } = old.needs;
    const migrated = parseAgentSpec({ ...old, schemaVersion: 1, needs });
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.trigger).toBe(old.slug);
    expect(migrated.instructions).toBe(old.instructions);
    expect(migrated.tools).toEqual([]);
  });
  it("migrates v2 to a one-shot worker whose missing answers surface as export problems", () => {
    const migrated = parseAgentSpec(v2());
    expect(migrated).toMatchObject({
      schemaVersion: 3,
      runtime: "worker",
      conversation: "oneShot",
      dataSources: [],
      output: { kind: "chat-message", template: [] },
      inputs: [{ name: "request", type: "text", required: true }],
    });
    const checks = specProblems(migrated).map((p) => p.check);
    expect(checks).toContain("method");
    expect(checks).toContain("output-template");
  });
  it("accepts drafts saved before follow-up details existed", () => {
    const { details, ...old } = draftSchema.parse({
      category: null, name: "", inputChips: [], outputChips: [], context: "",
      selectedTools: [], recommendations: [], noticed: [], followUp: "", step: "tools",
    });
    expect(details).toEqual(emptyDetails);
    expect(old.step).toBe("tools");
  });
});
const problems = (patch: Partial<AgentSpec>) =>
  specProblems({ ...exampleAgent, ...patch }).map((p) => p.message);
describe("export checks", () => {
  it("passes the example agent", () => expect(specProblems(exampleAgent)).toEqual([]));
  it.each([
    "The input described in the task",
    "Files & documents",
    "A designed interface",
    "Files & documents, A spreadsheet",
  ])("rejects placeholder text %s", (label) => {
    expect(isPlaceholder(label)).toBe(true);
    expect(
      problems({ inputs: [{ ...exampleAgent.inputs[0], label }] }),
    ).toContainEqual(expect.stringContaining("instead of the placeholder"));
  });
  it("does not flag real descriptions that mention a chip word", () =>
    expect(isPlaceholder("A spreadsheet of this week's leads")).toBe(false));
  it("requires the extension runtime for live output", () => {
    expect(
      problems({ output: { ...exampleAgent.output, kind: "widget" } }),
    ).toContain("This output needs the extension runtime.");
  });
  it("asks for live data when the task tracks something", () => {
    expect(
      problems({
        instructions: "Track the agents running on my machine.",
        inputs: [{ name: "request", label: "Request", type: "text", formats: [], required: true }],
      }),
    ).toContain("Where should this agent get its live data?");
    expect(
      problems({
        runtime: "extension",
        inputs: [],
        output: { ...exampleAgent.output, kind: "widget" },
      }),
    ).toContain("Where should this agent get its live data?");
  });
  it("forbids asking in one-shot mode but allows it in follow-up mode", () => {
    const instructions = "Ask the user for the square footage.";
    expect(problems({ instructions })).toContain(
      "One-shot agents can't ask; list missing inputs instead.",
    );
    expect(problems({ instructions, conversation: "followUp" })).toEqual([]);
  });
  it("requires a method for analysis agents", () =>
    expect(problems({ method: [] })).toContain(
      "Add the steps this agent should follow.",
    ));
  it("requires formats for file inputs and unique names", () => {
    const input = { ...exampleAgent.inputs[0], formats: [] };
    expect(problems({ inputs: [input, input] })).toEqual(
      expect.arrayContaining([
        "Input names must be unique: submissions.",
        "Add the file formats Form submissions CSV contains.",
      ]),
    );
  });
});
