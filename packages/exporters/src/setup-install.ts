// One-command install for a published setup: a POSIX sh script, generated only from
// validated items. Skill tokens are already shell-safe; every other value is single-quoted
// or written through a quoted here-document, so nothing in an agent's text is ever executed.
import type { SetupItem } from "@agents/spec/setups";
import { skillFiles } from "./index";

// Web Crypto: this module is also bundled into browser pages, where node:crypto doesn't exist.
const randomHex = () =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, "0")).join("");
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const comment = (value: string) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 200);
export interface InstallMeta {
  title: string;
  handle: string;
  url: string;
  /** Here-document delimiter seed; random by default. */
  nonce?: string;
}
export function setupInstallScript(items: SetupItem[], meta: InstallMeta): string {
  const skills = items.flatMap((item) => (item.kind === "skill" ? [item] : []));
  const agents = items.flatMap((item) => (item.kind === "agent" ? [item.spec] : []));
  const lines = [
    "#!/bin/sh",
    `# Agent Creations setup: ${comment(meta.title)} by @${comment(meta.handle)}`,
    `# Source: ${comment(meta.url)}`,
    "# Review this file before you run it. Skills install from their own repositories and agents",
    `# were written by @${comment(meta.handle)}. Agent Creations has not reviewed either.`,
    "# Agents go to $SKILLS_DIR (default ~/.claude/skills). For one project instead:",
    "#   SKILLS_DIR=.claude/skills sh setup.sh",
    "set -u",
    'SKILLS_DIR="${SKILLS_DIR:-$HOME/.claude/skills}"',
    'installed=0; skipped=0; failed=""',
    `echo ${quote(`Installing "${meta.title}" by @${meta.handle}: ${skills.length} skill${skills.length === 1 ? "" : "s"}, ${agents.length} agent${agents.length === 1 ? "" : "s"}`)}`,
    "",
  ];
  if (skills.length) {
    const all = skills.map((item) => item.skill).join(" ");
    lines.push("if command -v npx >/dev/null 2>&1; then");
    for (const item of skills)
      lines.push(
        `  if npx skills add ${quote(item.repository)} --skill ${quote(item.skill)}; then installed=$((installed + 1)); else failed="$failed ${item.skill}"; fi`,
      );
    lines.push("else", `  echo ${quote(`npx was not found. Install Node.js, then run this again to add: ${all}`)} >&2`, `  failed="$failed ${all}"`, "fi", "");
  }
  if (agents.length) lines.push('mkdir -p "$SKILLS_DIR" || exit 1', "");
  for (const spec of agents) {
    let content: string;
    try {
      content = Object.values(skillFiles(spec))[0];
    } catch (error) {
      lines.push(`# ${spec.slug} skipped: ${comment((error as Error).message)}`, `failed="$failed ${spec.slug}"`, "");
      continue;
    }
    // A delimiter that can't occur as a line of the file.
    let tag = `AC_SKILL_${meta.nonce || randomHex()}`;
    while (content.split("\n").includes(tag)) tag += "_";
    const dir = `"$SKILLS_DIR"/${quote(spec.slug)}`;
    lines.push(
      `if [ -e ${dir} ]; then`,
      `  echo "Skipped ${spec.slug}: $SKILLS_DIR/${spec.slug} already exists"; skipped=$((skipped + 1))`,
      `elif mkdir -p ${dir} && cat > ${dir}/SKILL.md <<'${tag}'`,
      content.replace(/\n$/, ""),
      tag,
      "then",
      `  echo "Installed agent ${spec.slug} in $SKILLS_DIR/${spec.slug}"; installed=$((installed + 1))`,
      "else",
      `  failed="$failed ${spec.slug}"`,
      "fi",
      "",
    );
  }
  lines.push(
    'echo "Done: $installed installed, $skipped skipped."',
    'if [ -n "$failed" ]; then echo "Not installed:$failed" >&2; exit 1; fi',
    "",
  );
  return lines.join("\n");
}
