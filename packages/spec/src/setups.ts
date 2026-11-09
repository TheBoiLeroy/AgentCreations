// A setup is one person's published package: skills referenced by source, plus agents
// built in the workshop. The site stores references and specs, never third-party code.
import { z } from "zod";
import { agentSchema, parseAgentSpec, triggerSchema, type AgentSpec } from "./index";

// GitHub usernames, lowercased. Also the profile URL segment.
export const handleSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/, "Invalid handle");
// Tokens go into copyable shell commands, so no spaces or shell metacharacters.
const repository = z
  .string()
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "Use owner/repository");
const skillName = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/, "Use the skill's folder name");
const note = z.string().trim().max(300).default("");
export const setupItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("skill"), repository, skill: skillName, note }).strict(),
  z.object({ kind: z.literal("agent"), spec: agentSchema, note }).strict(),
]);
export type SetupItem = z.infer<typeof setupItemSchema>;
export const setupSchema = z
  .object({
    title: z.string().trim().min(1, "Give your setup a title").max(80),
    slug: triggerSchema,
    description: z.string().trim().max(500),
    items: z.array(setupItemSchema).min(1, "Add at least one skill or agent").max(30),
    published: z.boolean(),
  })
  .strict()
  .superRefine((setup, context) => {
    const seen = new Set<string>();
    setup.items.forEach((item, i) => {
      const key =
        item.kind === "skill"
          ? `skill:${item.repository.toLowerCase()}/${item.skill.toLowerCase()}`
          : `agent:${item.spec.trigger}`;
      if (seen.has(key))
        context.addIssue({ code: "custom", path: ["items", i], message: "This item is already in the setup." });
      seen.add(key);
    });
    // Must fit the API body limit and the database check.
    if (new TextEncoder().encode(JSON.stringify(setup.items)).length > 56000)
      context.addIssue({ code: "custom", path: ["items"], message: "This setup is too large. Remove an agent or shorten its instructions." });
  });
export type Setup = z.infer<typeof setupSchema>;

/** Accepts the ways people paste a skill: a skills.sh link, an install command or owner/repo/skill. */
export function parseSkillReference(input: string): { repository: string; skill: string } | null {
  const text = input.trim();
  const command = text.match(/^(?:npx\s+)?skills\s+add\s+(\S+)\s+--skill[=\s]+(\S+)$/);
  // owner/repository must be joined by a slash; the skill may follow a slash or a space.
  const path = text
    .replace(/^https?:\/\/(?:www\.)?skills\.sh\//, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .match(/^([^\/\s]+)\/([^\/\s]+)(?:\/|\s+)([^\/\s]+)$/);
  const [owner, repo, skill] = command ? [...command[1].split("/"), command[2]] : (path || []).slice(1);
  if (!owner || !repo || !skill) return null;
  const parsed = z
    .object({ repository, skill: skillName })
    .safeParse({ repository: `${owner}/${repo}`, skill });
  return parsed.success ? parsed.data : null;
}
export const skillCommand = (item: { repository: string; skill: string }) =>
  `npx skills add ${item.repository} --skill ${item.skill}`;
/** One command per referenced skill. Agents are downloaded from the setup page instead. */
export function installScript(items: SetupItem[]): string {
  return items.flatMap((item) => (item.kind === "skill" ? [skillCommand(item)] : [])).join("\n");
}

/** A starting setup from the agents someone built: each agent, plus the external skills they rely on. */
export function setupFromAgents(specs: AgentSpec[]): { title: string; description: string; items: SetupItem[] } {
  const items: SetupItem[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(`agent:${spec.trigger}`)) continue;
    seen.add(`agent:${spec.trigger}`);
    items.push({ kind: "agent", spec, note: "" });
  }
  for (const spec of specs)
    for (const tool of spec.tools) {
      if (!tool.skillSource) continue;
      const key = `skill:${tool.skillSource.repository}/${tool.skillSource.skill}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ kind: "skill", ...tool.skillSource, note: `Used by ${spec.name}`.slice(0, 300) });
    }
  const agents = items.filter((item) => item.kind === "agent").length;
  const skills = items.length - agents;
  return {
    title: "My setup",
    description: `${agents} agent${agents === 1 ? "" : "s"}${skills ? ` and ${skills} skill${skills === 1 ? "" : "s"}` : ""} I use.`,
    items: items.slice(0, 30),
  };
}

export interface ImportResult {
  items: SetupItem[];
  /** Bare skill names (from a folder listing, "/grill-me", SKILL.md frontmatter) still needing a repository. */
  names: string[];
  /** Lines that couldn't be read, with the reason. */
  problems: string[];
}
const skillToken = /^\/?[a-z0-9][a-z0-9._-]{0,99}$/i;
/** GitHub links to a skill folder or its SKILL.md: github.com/owner/repo/(tree|blob)/<ref>/.../<skill>[/SKILL.md]. */
function fromGithubLink(line: string) {
  const match = line.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/(?:tree|blob)\/[^/\s]+\/((?:[^/\s]+\/)*[^/\s]+?)\/?(?:[?#]\S*)?$/);
  if (!match) return null;
  const parts = match[3].split("/");
  if (parts[parts.length - 1].toLowerCase() === "skill.md") parts.pop();
  const skill = parts[parts.length - 1];
  return parts.length && skill ? parseSkillReference(`${match[1]}/${match[2]}/${skill}`) : null;
}
/**
 * Reads a pasted setup: skill links and install commands, GitHub skill folders, agent JSON exports,
 * a setup JSON, SKILL.md frontmatter, or a plain list of skill names (e.g. `ls ~/.claude/skills`).
 */
export function parseSetupImport(text: string): ImportResult {
  const items: SetupItem[] = [];
  const names: string[] = [];
  const problems: string[] = [];
  const keys = new Set<string>();
  const add = (item: SetupItem) => {
    const key = item.kind === "skill" ? `skill:${item.repository}/${item.skill}`.toLowerCase() : `agent:${item.spec.trigger}`;
    if (!keys.has(key)) {
      keys.add(key);
      items.push(item);
    }
  };
  const name = (value: string) => {
    const clean = value.replace(/^\//, "").toLowerCase();
    if (!names.includes(clean)) names.push(clean);
  };
  const fromJson = (value: unknown): boolean => {
    if (Array.isArray(value)) {
      let any = false;
      for (const entry of value) any = (typeof entry === "string" ? (readLine(entry), true) : fromJson(entry)) || any;
      return any;
    }
    if (!value || typeof value !== "object") return false;
    if ("items" in value && Array.isArray((value as { items: unknown }).items)) return fromJson((value as { items: unknown[] }).items);
    const item = setupItemSchema.safeParse(value);
    if (item.success) return add(item.data), true;
    if ("schemaVersion" in value)
      try {
        add({ kind: "agent", spec: parseAgentSpec(value), note: "" });
        return true;
      } catch {
        problems.push("An agent JSON file isn’t a valid agent (schema versions 1–3).");
        return true;
      }
    return false;
  };
  function readLine(raw: string) {
    const line = raw
      .trim()
      .replace(/^(?:[-*•]|\d+[.)])\s+/, "")
      .replace(/^\$\s+/, "")
      .replace(/^`+|`+$/g, "")
      .trim();
    if (!line || line.startsWith("#") || line === "---") return;
    const frontmatter = line.match(/^name:\s*["']?([^"'\s]+)["']?$/);
    if (frontmatter) return skillToken.test(frontmatter[1]) ? name(frontmatter[1]) : undefined;
    if (/^description:/i.test(line)) return;
    const command = line.match(/^(?:npx\s+)?skills\s+add\s+(\S+)(.*)$/);
    if (command) {
      const skills = [...command[2].matchAll(/--skill(?:=|\s+)(\S+)/g)].map((m) => m[1]);
      if (!skills.length) return void problems.push(`“${line.slice(0, 80)}” installs a whole repository; name the skill with --skill.`);
      for (const skill of skills) {
        const parsed = parseSkillReference(`${command[1]}/${skill}`);
        if (parsed) add({ kind: "skill", ...parsed, note: "" });
        else problems.push(`“${line.slice(0, 80)}” isn’t a valid install command.`);
      }
      return;
    }
    const reference = parseSkillReference(line) || fromGithubLink(line);
    if (reference) return add({ kind: "skill", ...reference, note: "" });
    const tokens = line.split(/\s+/);
    if (tokens.every((token) => skillToken.test(token) && !token.includes("/", 1))) return tokens.forEach(name);
    problems.push(`Couldn’t read “${line.slice(0, 80)}”.`);
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("["))
    try {
      if (fromJson(JSON.parse(trimmed))) return { items, names, problems: problems.slice(0, 20) };
    } catch {
      /* Not JSON after all: read it line by line. */
    }
  trimmed.split(/\r?\n/).slice(0, 500).forEach(readLine);
  return { items: items.slice(0, 30), names: names.slice(0, 100), problems: problems.slice(0, 20) };
}
