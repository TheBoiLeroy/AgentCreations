import { describe, expect, it } from "vitest";
import { exampleAgent } from "./index";
import { installScript, parseSkillReference, setupSchema } from "./setups";

const pdf = { kind: "skill" as const, repository: "anthropics/skills", skill: "pdf", note: "" };
const base = { title: "Daily driver", slug: "daily-driver", description: "", items: [pdf], published: true };
describe("setups", () => {
  it("reads the ways people paste a skill", () => {
    for (const text of [
      "anthropics/skills/pdf",
      "anthropics/skills pdf",
      " https://skills.sh/anthropics/skills/pdf/ ",
      "https://www.skills.sh/anthropics/skills/pdf?ref=x",
      "npx skills add anthropics/skills --skill pdf",
      "skills add anthropics/skills --skill=pdf",
    ])
      expect(parseSkillReference(text)).toEqual({ repository: "anthropics/skills", skill: "pdf" });
  });
  it("rejects anything that could change the install command", () => {
    for (const text of [
      "anthropics/skills",
      "not a skill",
      "anthropics skills/pdf",
      "anthropics/skills/pdf/extra",
      "anthropics/skills/pdf;rm",
      "anthropics/skills/$(whoami)",
      "npx skills add anthropics/skills --skill pdf && curl evil.example",
      "https://evil.example/anthropics/skills/pdf",
      "",
    ])
      expect(parseSkillReference(text)).toBeNull();
    expect(setupSchema.safeParse({ ...base, items: [{ ...pdf, skill: "pdf; rm -rf ~" }] }).success).toBe(false);
    expect(setupSchema.safeParse({ ...base, items: [{ ...pdf, repository: "a/b c" }] }).success).toBe(false);
  });
  it("writes one command per skill and leaves agents to the download buttons", () => {
    const setup = setupSchema.parse({ ...base, items: [pdf, { kind: "agent", spec: exampleAgent }, { ...pdf, skill: "xlsx" }] });
    expect(installScript(setup.items)).toBe("npx skills add anthropics/skills --skill pdf\nnpx skills add anthropics/skills --skill xlsx");
  });
  it("rejects duplicates, empty setups, invalid agents and oversized packages", () => {
    expect(setupSchema.safeParse({ ...base, items: [pdf, { ...pdf, repository: "Anthropics/Skills" }] }).success).toBe(false);
    expect(setupSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(setupSchema.safeParse({ ...base, items: [{ kind: "agent", spec: { ...exampleAgent, slug: "other" } }] }).success).toBe(false);
    const big = (n: number) => ({ kind: "agent", spec: { ...exampleAgent, trigger: `agent-${n}`, slug: `agent-${n}`, instructions: "x".repeat(11000) } });
    expect(setupSchema.safeParse({ ...base, items: [1, 2, 3, 4, 5, 6].map(big) }).success).toBe(false);
    expect(setupSchema.safeParse({ ...base, items: [big(1)] }).success).toBe(true);
  });
});
import { parseSetupImport, setupFromAgents } from "./setups";

describe("setup from my agents", () => {
  it("adds each agent once, then the external skills they use", () => {
    const withSkill = {
      ...exampleAgent,
      name: "Deck maker",
      trigger: "deck-maker",
      slug: "deck-maker",
      tools: [{ id: "skill-presentations", requiresApproval: true, skillSource: { repository: "anthropics/skills", skill: "pptx" } }],
    };
    const result = setupFromAgents([exampleAgent, withSkill, exampleAgent]);
    expect(result.items.map((item) => (item.kind === "agent" ? item.spec.trigger : `${item.repository}/${item.skill}`))).toEqual([
      "lead-sorter",
      "deck-maker",
      "anthropics/skills/pptx",
    ]);
    expect(result.items[2]).toMatchObject({ note: "Used by Deck maker" });
    expect(result.description).toBe("2 agents and 1 skill I use.");
    expect(setupSchema.safeParse({ ...result, slug: "my-setup", published: true }).success).toBe(true);
  });
});
describe("import my real setup", () => {
  it("reads links, commands, GitHub folders, frontmatter and folder listings", () => {
    const result = parseSetupImport(`
# my skills
- https://skills.sh/anthropics/skills/pdf
$ npx skills add mattpocock/skills --skill grill-me --skill tdd
https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines
https://github.com/anthropics/skills/blob/main/skills/xlsx/SKILL.md
---
name: my-private-skill
description: Something I wrote
---
lead-sorter    deck-maker
/grill-me
npx skills add owner/repo
this is not a skill line!
`);
    expect(result.items.map((item) => item.kind === "skill" && `${item.repository}/${item.skill}`)).toEqual([
      "anthropics/skills/pdf",
      "mattpocock/skills/grill-me",
      "mattpocock/skills/tdd",
      "vercel-labs/agent-skills/web-design-guidelines",
      "anthropics/skills/xlsx",
    ]);
    expect(result.names).toEqual(["my-private-skill", "lead-sorter", "deck-maker", "grill-me"]);
    expect(result.problems).toEqual([
      "“npx skills add owner/repo” installs a whole repository; name the skill with --skill.",
      "Couldn’t read “this is not a skill line!”.",
    ]);
  });
  it("reads agent exports and setup JSON, and rejects unsafe tokens", () => {
    expect(parseSetupImport(JSON.stringify(exampleAgent)).items).toEqual([{ kind: "agent", spec: exampleAgent, note: "" }]);
    const setupJson = { items: [{ kind: "skill", repository: "a/b", skill: "c", note: "x" }, exampleAgent] };
    expect(parseSetupImport(JSON.stringify(setupJson)).items).toHaveLength(2);
    expect(parseSetupImport(JSON.stringify({ ...exampleAgent, slug: "mismatch" })).problems[0]).toContain("isn’t a valid agent");
    const unsafe = parseSetupImport("npx skills add a/b --skill 'x;rm'\nhttps://github.com/a/b/tree/main/$(whoami)");
    expect(unsafe.items).toEqual([]);
    expect(unsafe.problems).toHaveLength(2);
  });
});
