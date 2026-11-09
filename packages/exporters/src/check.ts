// Output checks that run on every export. They read the generated files, not the
// generator's intentions, so a template regression stops the download.
import { requirementProblems, type AgentSpec, type SpecProblem } from "@agents/spec";

const squash = (value: string) => value.toLowerCase().replace(/\s+/g, " ").replace(/[.!?\s]+$/, "").trim();
// Addresses used as documentation examples are not personal data.
const exampleDomains = /@(?:[a-z0-9-]+\.)*(?:example\.(?:com|org|net)|yourdomain\.com)$/i;
export const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const broken: [RegExp, string][] = [
  [/\b(?:asks?|wants?)\s+to\s+(?:an?\s+|the\s+)?(?:agent|assistant|bot|helper)\b/i, "reads as pasted request text"],
  [/\b(?:undefined|null|NaN)\b|\[object /, "contains an unfilled value"],
  [/ {2,}| [,.;]|\.\.|,,|“”|""/, "has broken punctuation or spacing"],
];
/** Problems with one description: it must be "<What it does>. Use when <situations>." */
export function descriptionProblems(description: string, request: string): string[] {
  const problems: string[] = [];
  const text = description.trim();
  if (!text) return ["is missing"];
  if (text.length > 1024) problems.push("is longer than 1,024 characters");
  if (!/^[A-Z][^]*?\. Use when [^]+\.$/.test(text)) problems.push("isn’t a “what it does. Use when…” sentence");
  if (squash(request).length >= 20 && squash(text).includes(squash(request)))
    problems.push("repeats the request word for word");
  for (const [pattern, reason] of broken) if (pattern.test(text)) problems.push(reason);
  return problems;
}
function headings(markdown: string): string[] {
  let fenced = false;
  return markdown.split("\n").flatMap((line) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    return !fenced && /^#{1,6}\s+\S/.test(line) ? [line.trim().toLowerCase()] : [];
  });
}
/** Any problem stops the export. `files` is exactly what the user would download. */
export function checkExport(spec: AgentSpec, files: Record<string, string>): SpecProblem[] {
  const problems: SpecProblem[] = [];
  const add = (check: string, field: string, message: string) => problems.push({ check, field, message });
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith(".md")) {
      const seen = new Set<string>();
      for (const heading of headings(content)) {
        if (seen.has(heading)) add("duplicate-heading", path, `${path} has the section “${heading.replace(/^#+\s+/, "")}” twice.`);
        seen.add(heading);
      }
      // A configured input must not be presented as optional.
      for (const input of spec.inputs.filter((x) => x.default !== undefined))
        for (const line of content.split("\n"))
          if (line.startsWith(`- ${input.name} (`) && /\boptional\b/.test(line.slice(0, line.indexOf("):") + 1)))
            add("configured-input", path, `${path} calls the configured input ${input.name} optional.`);
    }
    if (path.endsWith("SKILL.md")) {
      const front = content.match(/^---\nname: (.*)\ndescription: (.*)\n---\n/);
      let description = "";
      try {
        description = front ? String(JSON.parse(front[2])) : "";
      } catch {
        /* Reported below as a missing description. */
      }
      if (!front || front[1].trim() !== spec.slug) add("frontmatter", path, `${path} needs a name in its frontmatter.`);
      for (const reason of descriptionProblems(description, spec.needs.context))
        add("description", path, `The description in ${path} ${reason}.`);
    }
    // Bundled source is the same for every agent; everything else is generated from user input.
    if (!path.endsWith(".ts"))
      for (const address of new Set(content.match(emailPattern) || []))
        if (!exampleDomains.test(address))
          add("personal-data", path, `${path} contains the email address ${address}. Personal values belong in a per-user setting, not in a shared file.`);
  }
  for (const reason of descriptionProblems(spec.description, spec.needs.context))
    add("description", "description", `The agent description ${reason}.`);
  return [...problems, ...requirementProblems(spec)];
}
