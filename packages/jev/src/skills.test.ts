import { describe, expect, it } from "vitest";
import { agentSchema, emptyDetails, emptyDraft, agentPrompt } from "@agents/spec";
import { advise, catalog, createAgentSpec, getSkillSource, recommendRules } from "./index";

const input = { category: "creation-communication" as const, inputChips: [], outputChips: [], context: "" };
describe("curated skills.sh recommendations", () => {
  it.each([
    ["Read a PDF", "skill-pdf"],
    ["Create an Excel spreadsheet", "skill-spreadsheets"],
    ["Make a pitch deck", "skill-presentations"],
    ["Build a landing page", "skill-frontend-design"],
    ["Optimize React and Next.js", "skill-react-performance"],
    ["Run Playwright browser testing", "skill-webapp-testing"],
    ["Build an MCP server for our CRM", "skill-mcp-builder"],
    ["Help me write a skill for invoices", "skill-creator"],
    ["Design a poster for the open house", "skill-canvas-design"],
    ["Apply a theme to my report", "skill-theme-factory"],
    ["Write the weekly status report", "skill-internal-comms"],
    ["Make an animated GIF for Slack", "skill-slack-gif"],
    ["Create generative art with p5.js", "skill-algorithmic-art"],
  ])("recommends %s", (context, id) => {
    expect(recommendRules({ ...input, context }).recommendations).toContainEqual(expect.objectContaining({ id, source: "keyword" }));
    expect(getSkillSource(id)).toBeDefined();
  });
  it("does not match partial words", () => {
    const result = recommendRules({ ...input, context: "reactive excellence presentationsmith frontendish pdfkit posterity themed newsletters2 gifted skillset mcps" });
    expect(result.recommendations.some((r) => getSkillSource(r.id))).toBe(false);
  });
  it("retains explicit skill chips during model merging", async () => {
    const result = await advise({ ...input, context: "Help communicate my idea", outputChips: ["slide-deck"] }, async () => ({ picks: [], followUp: "" }));
    expect(result.recommendations).toContainEqual(expect.objectContaining({ id: "skill-presentations", source: "chip" }));
  });
  it("exports source and setup without granting runtime access", () => {
    const selectedTools = catalog.filter((t) => getSkillSource(t.id)).map((t) => t.id);
    const spec = createAgentSpec({ ...emptyDraft, category: input.category, name: "Designer", context: "Design my app", selectedTools, details: { ...emptyDetails, seeded: true, inputs: [{ label: "App brief", type: "text", formats: [], required: true }], template: "Design", whenToUse: "Use when the user wants an app designed." } }, "designer");
    expect(spec.tools.every((t) => t.requiresApproval && t.skillSource)).toBe(true);
    expect(spec.needs.connections).toEqual([]);
    const restored = agentSchema.parse(JSON.parse(JSON.stringify(spec)));
    const prompt = agentPrompt(restored);
    for (const tool of restored.tools) {
      expect(prompt).toContain(`https://skills.sh/${tool.skillSource!.repository}/${tool.skillSource!.skill}`);
      expect(prompt).toContain(`npx skills add ${tool.skillSource!.repository} --skill ${tool.skillSource!.skill}`);
    }
    expect(prompt).toContain("Not bundled or installed");
    expect(() => agentSchema.parse({ ...spec, tools: [{ ...spec.tools[0], skillSource: { repository: "foo/bar;evil", skill: "pdf" } }] })).toThrow();
  });
});
