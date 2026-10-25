import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import ts from "typescript";
import {
  agentJsonSchema,
  agentPrompt,
  agentSchema,
  exampleAgent,
  type AgentSpec,
} from "@agents/spec";
import {
  archive,
  behaviorTools,
  checkWorkerFiles,
  ExportError,
  exportProblems,
  hostedUrl,
  installation,
  piPackage,
  requiredEnv,
  skillFiles,
  toolRegistry,
  tools,
  workerConfig,
} from "./index";
const spec = (patch: Partial<AgentSpec>): AgentSpec => ({ ...exampleAgent, ...patch });
const tracker = spec({
  name: "Agent Tracker",
  slug: "agent-tracker",
  trigger: "agent-tracker",
  category: "support-oversight",
  runtime: "extension",
  inputs: [],
  method: [],
  tools: [],
  dataSources: ["session-events", "process-list"],
  output: { ...exampleAgent.output, kind: "widget", template: [] },
});
const pi = (s: AgentSpec) => exportProblems(s, "Pi").map((p) => p.message);

describe("neutral spec", () => {
  it("validates the sample and exposes JSON Schema", () => {
    expect(agentSchema.parse(exampleAgent)).toEqual(exampleAgent);
    expect(agentJsonSchema.definitions).toHaveProperty("AgentSpec");
  });
  it.each([
    "../escape",
    "a--b",
    "-a",
    "a-",
    "Hello",
    "a;touch-owned",
    "a/b",
    "a".repeat(65),
  ])("rejects unsafe slug %s", (slug) => {
    expect(agentSchema.safeParse({ ...exampleAgent, slug }).success).toBe(
      false,
    );
  });
  it("requires instructions, approvals and the supported schema version", () => {
    for (const patch of [
      { instructions: " " },
      { boundaries: [] },
      { schemaVersion: 4 },
      { credentials: "secret" },
    ])
      expect(agentSchema.safeParse({ ...exampleAgent, ...patch }).success).toBe(
        false,
      );
  });
  it("keeps requirements, boundaries and output in the prompt", () => {
    const prompt = agentPrompt(exampleAgent);
    for (const value of [
      exampleAgent.instructions,
      exampleAgent.startsWith,
      exampleAgent.givesBack,
      ...exampleAgent.method,
      ...exampleAgent.output.template,
      ...exampleAgent.boundaries,
      exampleAgent.output.destination,
    ])
      expect(prompt).toContain(value);
    expect(prompt).toContain("not granted permissions");
  });
});
describe("exports", () => {
  it("escapes multiline and YAML-sensitive skill descriptions", () => {
    const whenToUse = 'Use when: "reviewing"\n---\nname: malicious';
    const files = [
      skillFiles(spec({ skill: { whenToUse } }))["lead-sorter/SKILL.md"],
      piPackage(spec({ skill: { whenToUse } }))["skills/lead-sorter/SKILL.md"],
    ];
    for (const text of files)
      expect(text.split("\n")[2]).toBe(`description: ${JSON.stringify(whenToUse)}`);
  });
  it("creates a standalone worker package wired from the tool registry", () => {
    const files = piPackage(exampleAgent);
    const manifest = JSON.parse(files["package.json"]);
    expect(manifest.pi.extensions).toEqual(["./extensions/agent.ts"]);
    expect(Object.keys(manifest.dependencies || {})).toEqual([]);
    expect(JSON.parse(files["agent.json"])).toEqual(exampleAgent);
    expect(JSON.parse(files["worker.json"])).toEqual({
      tools: ["read", "grep", "find", "ls", "calc"],
      extensions: ["tools/calc.ts"],
      actions: [],
    });
    expect(files).toHaveProperty("tools/calc.ts");
    expect(files).not.toHaveProperty("tools/extract.ts");
    expect(files["extensions/agent.ts"]).toContain("shell: false");
    expect(files["extensions/agent.ts"]).toContain("'--no-extensions'");
    for (const path of ["extensions/agent.ts", "tools/calc.ts"]) {
      const output = ts.transpileModule(files[path], {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        reportDiagnostics: true,
      });
      expect(output.diagnostics).toEqual([]);
    }
  });
  it("writes instructions for the worker and a skill for the main agent", () => {
    const files = piPackage(exampleAgent);
    const instructions = files["instructions.md"];
    expect(instructions).toContain("1. Read every submission in the file.");
    expect(instructions).toContain("- submissions (file: csv): Form submissions CSV");
    expect(instructions).toContain("- Missing information");
    expect(instructions).not.toContain("- Missing inputs and assumptions");
    expect(
      piPackage(spec({ output: { ...exampleAgent.output, template: ["Shortlist"] } }))["instructions.md"],
    ).toContain("- Shortlist\n- Missing inputs and assumptions");
    expect(instructions).toContain("calc:");
    expect(instructions).not.toContain("extract_document");
    expect(instructions).not.toMatch(/ask for missing/i);
    const skill = files["skills/lead-sorter/SKILL.md"];
    expect(skill).toContain("`/lead-sorter <submissions>`");
    expect(skill).not.toContain(exampleAgent.instructions);
  });
  it("emits the extension template for live agents, without a skill or worker", () => {
    const files = piPackage(tracker);
    expect(Object.keys(files).sort()).toEqual(["README.md", "agent.json", "extensions/agent.ts", "package.json"]);
    expect(files["extensions/agent.ts"]).toContain("session_start");
    expect(JSON.parse(files["package.json"]).pi).toEqual({ extensions: ["./extensions/agent.ts"] });
    expect(installation(tracker, "Pi").example).toBe("/agent-tracker");
    expect(exportProblems(tracker, "Claude Code").map((p) => p.message)).toContain(
      "This agent runs as a Pi extension. Choose Pi to export it.",
    );
  });
  it("packs usable paths in real ZIP archives", () => {
    const files = piPackage(exampleAgent);
    const zip = unzipSync(archive(files, "lead-sorter-pi"));
    expect(strFromU8(zip["lead-sorter-pi/package.json"])).toBe(
      files["package.json"],
    );
    expect(Object.keys(zip)).toHaveLength(Object.keys(files).length);
  });
  it("uses local install commands, not unpublished npm names", () => {
    expect(installation(exampleAgent, "Pi").snippet).toContain(
      "pi install ./lead-sorter-pi",
    );
    expect(installation(exampleAgent, "Claude Code").snippet).toContain(
      "~/.claude/skills",
    );
    expect(installation(exampleAgent, "Codex").snippet).toContain(
      "~/.agents/skills",
    );
    expect(installation(exampleAgent, "Pi").example).toBe(
      "/lead-sorter ./form-submissions-csv.csv",
    );
    for (const target of tools.filter((t) => t !== "Pi"))
      expect(installation(exampleAgent, target).example).toContain(
        exampleAgent.startsWith,
      );
  });
  it("marks hosted setup and OAuth limitations explicitly", () => {
    expect(installation(exampleAgent, "ChatGPT").snippet).toContain(
      "Configure and deploy",
    );
    expect(installation(exampleAgent, "Claude app").note).toContain(
      "not OAuth",
    );
    const config = JSON.parse(
      installation(exampleAgent, "Cursor", "https://example.com").snippet,
    );
    expect(config.mcpServers["lead-sorter"].url).toBe(
      "https://example.com/agents/lead-sorter/mcp",
    );
  });
  it.each([
    "http://example.com",
    "https://user:pass@example.com",
    "javascript:alert(1)",
    "https://example.com?secret=1",
    "https://example.com/#token",
  ])("rejects unsafe endpoints %s", (url) => {
    expect(() => hostedUrl(url, "lead-sorter")).toThrow();
  });
});
describe("tool registry and export checks", () => {
  it("stops the export for tools the exporter can't supply", () => {
    const s = spec({
      tools: [
        ...exampleAgent.tools,
        { id: "read-email", requiresApproval: false },
        { id: "skill-pdf", requiresApproval: true, skillSource: { repository: "anthropics/skills", skill: "pdf" } },
      ],
    });
    expect(pi(s)).toEqual(
      expect.arrayContaining([
        "`read-email` isn't a tool this exporter can supply. It needs a mailbox connection, which Pi packages can't supply. Remove it, or add the emails as a file input.",
        expect.stringContaining("`skill-pdf` isn't a tool this exporter can supply. External skills can't be bundled"),
      ]),
    );
    expect(() => piPackage(s)).toThrow(ExportError);
  });
  it("bundles web search and hands approved email to the command", () => {
    const s = spec({
      name: "Research digest",
      category: "information-analysis",
      skillAnswers: { topics: "AI", recipient: "me@example.com" },
      tools: [
        { id: "web-search", requiresApproval: false },
        { id: "send-email", requiresApproval: true },
      ],
      inputs: [{ name: "researchTopics", label: "Research topics", type: "text", formats: [], required: false }],
    });
    expect(pi(s)).toEqual([]);
    const files = piPackage(s);
    expect(JSON.parse(files["worker.json"])).toEqual({
      tools: ["web_search", "fetch_page"],
      extensions: ["tools/web.ts"],
      actions: ["send-email"],
    });
    expect(files["tools/web.ts"]).toContain("registerTool");
    expect(files["instructions.md"]).toContain("## Proposed actions");
    expect(files["instructions.md"]).toContain("fenced block tagged send-email");
    expect(files["instructions.md"]).toContain("- recipient: me@example.com");
    expect(files["README.md"]).toContain("`BRAVE_API_KEY`");
    expect(files["README.md"]).toContain("`RESEND_API_KEY`");
    expect(files["README.md"]).not.toContain("Web access is not supplied");
    expect(checkWorkerFiles(s, files)).toEqual([]);
    expect(requiredEnv(["web-search", "send-email"])).toEqual(["BRAVE_API_KEY", "RESEND_API_KEY", "EMAIL_FROM"]);
  });
  it("keeps email actions off extension agents", () => {
    expect(pi(spec({ ...tracker, tools: [{ id: "send-email", requiresApproval: true }] }))).toContain(
      "`send-email` needs a model run, which extension agents don't have. Remove it or choose the worker runtime.",
    );
  });
  it("gives behavior tools no flags and lists only granted tools", () => {
    expect(workerConfig(behaviorTools)).toEqual({ tools: [], extensions: [], actions: [] });
    const files = piPackage(spec({ category: "creation-communication", method: [], tools: [{ id: "draft-text", requiresApproval: false }], inputs: [{ name: "notes", label: "Meeting notes", type: "text", formats: [], required: true }] }));
    expect(JSON.parse(files["worker.json"]).tools).toEqual([]);
    expect(files["instructions.md"]).toContain("You have no tools.");
    expect(files["instructions.md"]).not.toContain("draft-text");
  });
  it("never promises calculation without the calc tool", () => {
    const entry = toolRegistry["analyze-data"];
    expect(entry).toMatchObject({ kind: "grant", piTools: ["calc"], bundle: { path: "tools/calc.ts" } });
  });
  it("requires extract-documents for PDF, Word and Excel inputs", () => {
    const s = spec({ inputs: [{ name: "pastEstimates", label: "Past estimates", type: "folder", formats: ["pdf", "xlsx", "xls"], required: true }] });
    expect(pi(s)).toEqual(
      expect.arrayContaining([
        "Add `extract-documents` to read `pdf` files.",
        "Add `extract-documents` to read `xlsx` files.",
        expect.stringContaining("`xls` files can't be read by a Pi worker."),
      ]),
    );
    const fixed = spec({ ...s, inputs: [{ ...s.inputs[0], formats: ["pdf", "xlsx"] }], tools: [...exampleAgent.tools, { id: "extract-documents", requiresApproval: false }] });
    expect(pi(fixed)).toEqual([]);
    expect(piPackage(fixed)).toHaveProperty("tools/extract.ts");
  });
  it("keeps live data and model tools on the right runtime", () => {
    expect(pi(spec({ tools: [{ id: "session-events", requiresApproval: false }] }))).toContain("`session-events` only works in extension agents.");
    expect(pi(spec({ ...tracker, tools: [{ id: "read-files", requiresApproval: false }] }))).toContain(
      "`read-files` needs a model run, which extension agents don't have. Remove it or choose the worker runtime.",
    );
    expect(pi(spec({ ...tracker, dataSources: ["connection:github"] }))).toContain("`connection:github` isn't a data source this exporter can supply.");
  });
  it("rejects connection inputs and unsafe file destinations for workers", () => {
    expect(pi(spec({ inputs: [{ name: "crm", label: "Customer records", type: "connection", formats: [], required: true }] }))).toContainEqual(expect.stringContaining("Pi workers can't supply connections"));
    for (const destination of ["../x.md", "/etc/x", "a/../../x"])
      expect(pi(spec({ output: { ...exampleAgent.output, kind: "file", destination } }))).toContainEqual(expect.stringContaining("relative path"));
    expect(pi(spec({ output: { ...exampleAgent.output, kind: "file", destination: "reports/leads.md" } }))).toEqual([]);
  });
  it("self-tests generated files: selected tools are wired and instructions match flags", () => {
    const files = piPackage(exampleAgent);
    expect(checkWorkerFiles(exampleAgent, files)).toEqual([]);
    const broken = { ...files, "worker.json": JSON.stringify({ tools: ["read", "grep", "find", "ls"], extensions: [] }) };
    expect(checkWorkerFiles(exampleAgent, broken).map((p) => p.message)).toEqual([
      "`analyze-data` was selected but isn't wired up.",
      "`calc` is listed in the instructions but missing from the worker's flags.",
    ]);
  });
});
