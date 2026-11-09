import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { exampleAgent, type AgentSpec } from "@agents/spec";
import type { SetupItem } from "@agents/spec/setups";
import { piPackage, setupInstallScript, skillFiles } from "./index";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
/** Runs the script with sh in a throwaway HOME. A fake npx records its arguments; `npxCode` sets its exit code. */
function run(script: string, { npx = true, npxCode = 0, pi = false, env = {} as Record<string, string> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "setup-install-"));
  dirs.push(dir);
  const home = join(dir, "home");
  const bin = join(dir, "bin");
  mkdirSync(home);
  mkdirSync(bin);
  if (npx) {
    writeFileSync(join(bin, "npx"), `#!/bin/sh\necho "$@" >> "${join(dir, "npx.log")}"\nexit ${npxCode}\n`);
    chmodSync(join(bin, "npx"), 0o755);
  }
  if (pi) {
    writeFileSync(join(bin, "pi"), `#!/bin/sh\necho "$PWD $@" >> "${join(dir, "pi.log")}"\n`);
    chmodSync(join(bin, "pi"), 0o755);
  }
  writeFileSync(join(dir, "setup.sh"), script);
  const result = spawnSync("/bin/sh", ["setup.sh"], {
    cwd: dir,
    env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, ...env },
    encoding: "utf8",
  });
  const log = existsSync(join(dir, "npx.log")) ? readFileSync(join(dir, "npx.log"), "utf8") : "";
  return { ...result, dir, home, log };
}
const pdf: SetupItem = { kind: "skill", repository: "anthropics/skills", skill: "pdf", note: "" };
const grill: SetupItem = { kind: "skill", repository: "mattpocock/skills", skill: "grill-me", note: "" };
const meta = { title: `Ian's "daily" $(driver)`, handle: "eliancoder", url: "http://127.0.0.1:3000/u/eliancoder/daily-driver" };

describe("one-command setup install", () => {
  it("installs every skill and agent, and reports what it did", () => {
    const result = run(setupInstallScript([pdf, grill, { kind: "agent", spec: exampleAgent, note: "" }], meta));
    expect(result.status).toBe(0);
    expect(result.log).toBe("skills add anthropics/skills --skill pdf\nskills add mattpocock/skills --skill grill-me\n");
    expect(readFileSync(join(result.home, ".claude/skills/lead-sorter/SKILL.md"), "utf8")).toBe(Object.values(skillFiles(exampleAgent))[0]);
    expect(result.stdout).toContain(`Installing "Ian's "daily" $(driver)" by @eliancoder: 2 skills, 1 agent`);
    expect(result.stdout).toContain("Done: 3 installed, 0 skipped.");
  });
  it("never overwrites an existing skill and honours SKILLS_DIR", () => {
    const script = setupInstallScript([{ kind: "agent", spec: exampleAgent, note: "" }], meta);
    const first = run(script, { env: { SKILLS_DIR: "project/.claude/skills" } });
    expect(existsSync(join(first.dir, "project/.claude/skills/lead-sorter/SKILL.md"))).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "setup-install-existing-"));
    dirs.push(dir);
    mkdirSync(join(dir, "lead-sorter"), { recursive: true });
    writeFileSync(join(dir, "lead-sorter/SKILL.md"), "mine");
    const second = run(script, { env: { SKILLS_DIR: dir } });
    expect(readFileSync(join(dir, "lead-sorter/SKILL.md"), "utf8")).toBe("mine");
    expect(second.stdout).toContain("Skipped lead-sorter");
    expect(second.status).toBe(0);
  });
  it("executes nothing from an agent's text, even a line that looks like the delimiter", () => {
    const hostile: AgentSpec = {
      ...exampleAgent,
      instructions: "Review leads.\n$(touch pwned-1)\n`touch pwned-2`\nAC_SKILL_fixed\n'; touch pwned-3; '\nEOF",
    };
    const script = setupInstallScript([{ kind: "agent", spec: hostile, note: "" }], { ...meta, nonce: "fixed" });
    const result = run(script);
    expect(result.status).toBe(0);
    for (const n of [1, 2, 3]) expect(existsSync(join(result.dir, `pwned-${n}`))).toBe(false);
    expect(readFileSync(join(result.home, ".claude/skills/lead-sorter/SKILL.md"), "utf8")).toBe(Object.values(skillFiles(hostile))[0]);
  });
  it("fails clearly when npx is missing or a skill fails, and skips agents that can't be exported", () => {
    const missing = run(setupInstallScript([pdf], meta), { npx: false });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("npx was not found");
    expect(missing.stderr).toContain("Not installed: pdf");
    const failing = run(setupInstallScript([pdf, grill], meta), { npxCode: 1 });
    expect(failing.stderr).toContain("Not installed: pdf grill-me");
    const broken = { ...exampleAgent, description: "no trigger sentence" };
    const script = setupInstallScript([{ kind: "agent", spec: broken, note: "" }], meta);
    expect(script).toContain("# lead-sorter skipped:");
    expect(run(script).stderr).toContain("Not installed: lead-sorter");
  });
});

describe("Pi agents in a setup", () => {
  const tracker: AgentSpec = {
    ...exampleAgent,
    name: "Agent Tracker",
    trigger: "agent-tracker",
    slug: "agent-tracker",
    runtime: "extension",
    description: "Shows a live terminal panel of session-events and process-list. Use when the user wants to see or hide this live view, or runs /agent-tracker.",
    inputs: [],
    method: [],
    tools: [],
    dataSources: ["session-events", "process-list"],
    output: { ...exampleAgent.output, kind: "widget", template: [], destination: "Show it in the Pi terminal." },
    skill: { whenToUse: "Use when the user wants to see or hide this live view, or runs /agent-tracker." },
  };
  it("writes the whole Pi package and installs it with pi when Pi is present", () => {
    const result = run(setupInstallScript([{ kind: "agent", spec: tracker, note: "" }], meta), { pi: true });
    expect(result.status).toBe(0);
    const dir = join(result.home, ".agent-creations/pi-packages/agent-tracker");
    // A here-document always ends the file with a newline; JSON stays identical once parsed.
    for (const [path, content] of Object.entries(piPackage(tracker)))
      expect(readFileSync(join(dir, path), "utf8")).toBe(content.endsWith("\n") ? content : `${content}\n`);
    expect(JSON.parse(readFileSync(join(dir, "agent.json"), "utf8"))).toEqual(JSON.parse(piPackage(tracker)["agent.json"]));
    expect(readFileSync(join(result.dir, "pi.log"), "utf8").trim()).toBe(`${dir} install .`);
    expect(result.stdout).toContain("Installed Pi agent /agent-tracker. Restart Pi to use it.");
    expect(existsSync(join(result.home, ".claude/skills/agent-tracker"))).toBe(false);
  });
  it("writes the package and says how to install it when Pi isn't installed", () => {
    const result = run(setupInstallScript([{ kind: "agent", spec: tracker, note: "" }], meta));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Install Pi, then run:");
    expect(existsSync(join(result.home, ".agent-creations/pi-packages/agent-tracker/extensions/agent.ts"))).toBe(true);
  });
});
