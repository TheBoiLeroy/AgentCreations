// A setup is one person's published package: skills referenced by source, plus agents
// built in the workshop. The site stores references and specs, never third-party code.
import { z } from "zod";
import { agentSchema, triggerSchema } from "./index";

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
