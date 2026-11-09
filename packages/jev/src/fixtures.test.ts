// Regression fixtures: whole requests through extraction, generation, export and the checker.
// The first one is the exported agent that originally came out wrong in nine ways.
import { describe, expect, it } from "vitest";
import { emptyDraft, specConflicts, specProblems, type AgentSpec, type BuildDraft } from "@agents/spec";
import { checkExport, exportProblems, piPackage, skillFiles } from "@agents/exporters";
import { createAgentSpec, pendingQuestions, proposeRules, recommendRules, suggestDetails } from "./index";

const email = "ian@personal-mail.dev";
/** The manual builder path: Jev recommends, the details page is seeded, the user answers. */
function build(name: string, context: string, answers: Record<string, string> = {}, category: BuildDraft["category"] = "information-analysis") {
  const picks = recommendRules({ category: category!, inputChips: [], outputChips: [], context });
  const base: BuildDraft = {
    ...emptyDraft,
    category,
    name,
    context,
    recommendations: picks.recommendations,
    selectedTools: picks.recommendations.map((r) => r.id),
    requirements: picks.requirements,
    requirementsConfirmed: true,
  };
  const draft = { ...base, details: { ...suggestDetails(base), skillAnswers: answers } };
  return { draft, requirements: picks.requirements };
}
const skill = (spec: AgentSpec) => Object.values(skillFiles(spec))[0];
const byType = (spec: AgentSpec) => Object.fromEntries((spec.requirements || []).map((r) => [r.type, r]));
function expectClean(spec: AgentSpec) {
  expect(specProblems(spec)).toEqual([]);
  expect(exportProblems(spec, "Pi")).toEqual([]);
  for (const files of [skillFiles(spec), piPackage(spec)]) expect(checkExport(spec, files)).toEqual([]);
  // Every confirmed requirement points at a real place in the spec.
  for (const r of spec.requirements || []) expect(r.coveredBy.length, r.id).toBeGreaterThan(0);
}

describe("fixture: emailed 5 minute read about my interests", () => {
  const request = "Agent that will email me a 5 minute read about my current interests";
  const { draft, requirements } = build("Research Agent Email", request, { topics: "AI,Politics,Energy", recipient: email });
  const spec = createAgentSpec(draft, "research-agent-email");
  const text = skill(spec);
  it("extracts every requirement with its source quote, marking the assumed cadence", () => {
    expect(requirements.map(({ type, value, origin }) => [type, value, origin])).toEqual([
      ["delivery", "email", "stated"],
      ["recipient", "self", "stated"],
      ["length", "1000-1200 words", "stated"],
      ["trigger", "weekly", "assumed"],
      ["research", "web", "stated"],
      ["tone", "neutral, with claims attributed to their sources", "assumed"],
    ]);
    for (const r of requirements) if (r.origin === "stated") expect(request.toLowerCase()).toContain(r.quote.toLowerCase());
    expect(pendingQuestions(draft)).toEqual([]);
  });
  it("1–2: writes a trigger description and doesn't repeat it in the body", () => {
    expect(spec.description).toBe(
      "Researches AI,Politics,Energy and emails a 5-minute read every week. Use when the user wants an emailed read on AI,Politics,Energy, or runs /research-agent-email.",
    );
    expect(spec.description.toLowerCase()).not.toContain(request.toLowerCase());
    expect(text.split("\n")[2]).toBe(`description: ${JSON.stringify(spec.description)}`);
    expect(text.split("---\n")[2]).not.toContain(spec.description);
  });
  it("3: emits each section once", () => {
    const headings = text.match(/^## .*$/gm)!;
    expect(new Set(headings).size).toBe(headings.length);
    expect(headings).not.toContain("## Input");
    expect(headings).not.toContain("## Required sections");
  });
  it("4: marks configured inputs as configured, not optional", () => {
    expect(text).toContain('- researchTopics (text, configured as "AI,Politics,Energy"; pass a value to override it): Research topics');
    expect(text).not.toMatch(/researchTopics \([^)]*optional/);
  });
  it("5: keeps the email address out of every exported file", () => {
    expect(spec.settings).toEqual([{ id: "recipient", label: "Email recipient", type: "email", env: "EMAIL_TO" }]);
    for (const files of [skillFiles(spec), piPackage(spec)])
      for (const content of Object.values(files)) expect(content).not.toContain(email);
    expect(text).toContain("## Settings (each person sets their own)");
    expect(piPackage(spec)["README.md"]).toContain("`EMAIL_TO`");
  });
  it("6: sends the email instead of drafting it", () => {
    expect(spec.output.delivery).toBe("email");
    expect(spec.method[spec.method.length - 1]).toBe("Send the email to the recipient setting: a clear subject, then the full read.");
    expect(spec.output.destination).toContain("Email it to the recipient setting");
    expect(spec.output.template).toEqual(["Findings", "Sources", "Assumptions"]);
    expect(spec.givesBack).toBe("An email with: Findings, Sources, Assumptions");
    expect(byType(spec).delivery.coveredBy).toEqual(["output.delivery", `method.${spec.method.length - 1}`]);
  });
  it("7: targets 1,000–1,200 words and drops the one-bullet rule", () => {
    expect(spec.output.length).toEqual({ minWords: 1000, maxWords: 1200 });
    expect(spec.method.join("\n")).not.toContain("one short bullet");
    expect(spec.method.join("\n")).toContain("about 1000–1200 words (a 5-minute read)");
    expect(text).toContain("Length: about 1000–1200 words");
  });
  it("8: records the recurring trigger as a confirmed assumption", () => {
    expect(spec.schedule).toEqual({ cadence: "weekly" });
    expect(byType(spec).trigger).toMatchObject({ origin: "assumed", coveredBy: ["schedule"] });
    expect(text).toContain("## Schedule\nMeant to run on its own every week.");
    expect(piPackage(spec)["README.md"]).toContain("## Schedule");
  });
  it("9: never stalls on approval for mail to the owner", () => {
    expect(spec.tools.find((t) => t.id === "send-email")?.requiresApproval).toBe(false);
    expect(spec.boundaries.join("\n")).not.toContain("Ask before sending messages");
    expect(specConflicts(spec)).toEqual([]);
    expect(text).toContain("This agent runs unattended. Never stop to ask a question");
    expect(text).not.toContain("wait for the user's yes");
    expect(piPackage(spec)["instructions.md"]).toContain("The command sends it without asking");
  });
  it("10: selects web research without the word “research”", () => {
    expect(draft.selectedTools).toEqual(expect.arrayContaining(["web-search", "send-email"]));
  });
  it("passes every export check", () => expectClean(spec));
  it("gets the same requirements and skills from the describe box", () => {
    const proposed = proposeRules(request).draft;
    expect(proposed.requirements).toEqual(requirements);
    expect(proposed.selectedTools).toEqual(expect.arrayContaining(["web-search", "send-email"]));
    // Topics and the recipient are the only things left to ask.
    expect(pendingQuestions(proposed).map((q) => q.field).sort()).toEqual(["skillAnswers.recipient", "skillAnswers.topics"]);
  });
});

describe("fixture: one-off research with no sending", () => {
  const { draft, requirements } = build("EV Battery Brief", "Research solid state batteries and give me a 300 word summary", { topics: "solid state batteries" });
  const spec = createAgentSpec(draft, "ev-battery-brief");
  it("stays on demand, replies in the conversation and has no settings", () => {
    expect(requirements.map((r) => r.type)).toEqual(["delivery", "length", "research", "topics", "tone"]);
    expect(spec.schedule).toBeUndefined();
    expect(spec.settings).toBeUndefined();
    expect(spec.output.delivery).toBeUndefined();
    expect(spec.output.length).toEqual({ minWords: 270, maxWords: 330 });
    expect(spec.tools.map((t) => t.id)).toEqual(["web-search"]);
    expect(spec.method.join("\n")).not.toMatch(/\bsend\b/i);
    expect(skill(spec)).not.toContain("## Schedule");
    expect(spec.description).toMatch(/^Researches solid state batteries and returns a 1-minute read\. Use when /);
  });
  it("passes every export check", () => expectClean(spec));
});

describe("fixture: scheduled change to an external service that must ask", () => {
  const { draft } = build("CRM Tidy", "Every weekday, check new leads and update CRM records with a priority score", {}, "action-automation");
  const answered = {
    ...draft,
    details: { ...draft.details, inputs: [{ label: "Lead export", type: "text" as const, formats: [], required: true }], template: "Changes proposed\nAssumptions", method: "1. Score each lead from 1 to 5." },
  };
  const spec = createAgentSpec(answered, "crm-tidy");
  it("keeps approval, and says plainly that scheduled runs wait for it", () => {
    expect(spec.schedule).toEqual({ cadence: "weekdays" });
    expect(spec.tools.find((t) => t.id === "update-records")?.requiresApproval).toBe(true);
    expect(spec.boundaries[0]).toBe("Ask before sending messages, creating events, or changing records.");
    expect(spec.boundaries.join("\n")).toContain("On a scheduled run, stop at each action that needs approval");
    expect(specConflicts(spec)).toEqual([expect.stringContaining("update-records must wait for your approval")]);
    expect(skill(spec)).toContain("wait for the user's yes");
  });
  it("has no spec or skill-export problems (Pi can't supply a CRM connection)", () => {
    expect(specProblems(spec)).toEqual([]);
    expect(checkExport(spec, skillFiles(spec))).toEqual([]);
    expect(new Set(exportProblems(spec, "Pi").map((p) => p.check))).toEqual(new Set(["tool"]));
  });
});

describe("requirement coverage", () => {
  const { draft } = build("Research Agent Email", "Agent that will email me a 5 minute read about my current interests", { topics: "AI", recipient: email });
  it("flags a requirement the agent can no longer meet instead of dropping it", () => {
    const withoutEmail = { ...draft, selectedTools: draft.selectedTools.filter((id) => id !== "send-email") };
    const spec = createAgentSpec(withoutEmail, "research-agent-email");
    const messages = specProblems(spec).map((p) => p.message);
    expect(messages).toEqual([
      expect.stringContaining("“Sends the result by email” isn’t handled by this agent yet. Switch on “Send email”"),
      expect.stringContaining("“The email goes to you, at an address you set” isn’t handled"),
    ]);
    expect(() => skillFiles(spec)).toThrow("Sends the result by email");
  });
  it("rejects a spec whose coverage points at something that doesn't exist", () => {
    const spec = createAgentSpec(draft, "research-agent-email");
    const forged = { ...spec, schedule: undefined };
    expect(specProblems(forged).map((p) => p.field)).toEqual(["requirements.trigger"]);
    const shortened = { ...spec, output: { ...spec.output, length: { minWords: 100, maxWords: 150 } } };
    expect(specProblems(shortened).map((p) => p.field)).toEqual(["requirements.length"]);
  });
});

describe("outgoing email doesn't select mailbox reading", () => {
  it.each([
    "Agent that sends me an email with a 5 minute read about my interests",
    "Agent that emails me a weekly digest of my interests",
    "Send an email to me every Friday with AI news",
  ])("%s", (text) => {
    const { draft } = proposeRules(text);
    expect(draft.selectedTools).toContain("send-email");
    expect(draft.selectedTools).not.toContain("read-email");
  });
  it.each(["Summarize my emails every morning", "Read my inbox and draft replies", "Triage incoming emails from customers"])("%s still reads mail", (text) => {
    expect(proposeRules(text).draft.selectedTools).toContain("read-email");
  });
  it("never blocks creation over a Pi-only problem", () => {
    const { draft } = proposeRules("Read my inbox and draft replies");
    const spec = createAgentSpec({ ...draft, requirementsConfirmed: true, details: { ...draft.details, inputs: [{ label: "Emails to answer", type: "text", formats: [], required: true }] } }, "inbox");
    expect(specProblems(spec)).toEqual([]);
    expect(exportProblems(spec, "Pi").map((p) => p.check)).toContain("tool");
    expect(exportProblems(spec, "Claude Code")).toEqual([]);
  });
});
