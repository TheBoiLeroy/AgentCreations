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
