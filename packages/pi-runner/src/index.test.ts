import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import vm from "node:vm";
import * as nodePath from "node:path";
import ts from "typescript";
import { zipSync, strToU8 } from "fflate";
import { extensionSource, runnerSource } from "./index";
import { renderTemplates } from "../scripts/embed";
import { evaluate } from "../templates/calc";
import { extractText, pdf, unzip } from "../templates/extract";
import { parseProcesses } from "../templates/extension";
import { allowedRecipients, emailProposal, tokenize } from "../templates/worker";
import { pageText, publicUrl } from "../templates/web";

const baseSpec = {
  slug: "estimates",
  name: "Estimates",
  description: "Estimate a job",
  conversation: "oneShot",
  output: { kind: "chat-message", destination: "Return it" },
  dataSources: [],
  inputs: [
    { name: "pastEstimates", label: "Past estimates", type: "folder", formats: ["pdf"], required: true },
    { name: "newJob", label: "New job", type: "text", formats: [], required: true },
  ],
};
function load(
  source: string,
  files: Record<string, unknown>,
  fs: Record<string, unknown> = {},
) {
  const worker = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
    kill: vi.fn(),
  });
  const spawn = vi.fn(() => worker);
  const events: Record<string, (event?: unknown, ctx?: unknown) => Promise<void>> = {};
  const ctx = {
    cwd: "/workspace",
    hasUI: true,
    model: { provider: "anthropic", id: "test-model" },
    ui: { notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn(), confirm: vi.fn(async () => true) },
  };
  let handler: (args: string, context: typeof ctx) => Promise<void> = async () => {};
  const pi = {
    on: (name: string, fn: () => Promise<void>) => {
      events[name] = fn;
    },
    registerCommand: (_name: string, command: { handler: typeof handler }) => {
      handler = command.handler;
    },
    sendMessage: vi.fn(),
  };
  const output = ts.transpileModule(
    source.replaceAll("import.meta.url", "'file:///package/extensions/agent.ts'"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const exports: { default?: (api: typeof pi) => void } = {};
  const fsMock = {
    readFileSync: (url: URL | string) => {
      const name = String(url).split("/").pop()!;
      if (name in files) return JSON.stringify(files[name]);
      throw new Error("ENOENT " + name);
    },
    statSync: vi.fn((path: string) => {
      if (path === "/workspace/past") return { isDirectory: () => true, isFile: () => false };
      if (path === "/workspace/job.txt") return { isDirectory: () => false, isFile: () => true };
      throw new Error("ENOENT");
    }),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    openSync: vi.fn(),
    readSync: vi.fn(),
    closeSync: vi.fn(),
    ...fs,
  };
  vm.runInNewContext(output, {
    exports,
    URL,
    Buffer,
    process,
    setTimeout,
    clearTimeout,
    AbortSignal,
    fetch: (...call: Parameters<typeof fetch>) => globalThis.fetch(...call),
    setInterval,
    clearInterval,
    require: (name: string) => {
      if (name === "node:child_process") return { spawn };
      if (name === "node:fs") return fsMock;
      if (name === "node:url") return { fileURLToPath: (url: URL) => url.pathname };
      if (name === "node:os") return { homedir: () => "/home/me", tmpdir: () => "/tmp" };
      if (name === "node:path") return nodePath;
      throw new Error(`Unexpected runtime dependency: ${name}`);
    },
  });
  exports.default!(pi);
  return { worker, spawn, events, ctx, pi, fs: fsMock, invoke: (args: string) => handler(args, ctx) };
}
const setup = (spec: Record<string, unknown> = {}, config: { tools: string[]; extensions: string[]; actions?: string[] } = { tools: [], extensions: [] }) =>
  load(runnerSource, { "agent.json": { ...baseSpec, ...spec }, "worker.json": config });
const args = (s: ReturnType<typeof setup>) => (s.spawn.mock.calls[0] as unknown as [string, string[]])[1];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("generated Pi worker", () => {
  it("takes flags from worker.json, not hard-coded checks", async () => {
    const none = setup();
    await none.invoke('./past "kitchen remodel"');
    expect(args(none)).toContain("--no-tools");
    const granted = setup({}, { tools: ["read", "grep", "find", "ls", "calc"], extensions: ["tools/calc.ts"] });
    await granted.invoke("./past kitchen");
    expect(args(granted)).toEqual(
      expect.arrayContaining(["--tools", "read,grep,find,ls,calc", "--extension", "/package/tools/calc.ts", "--no-extensions", "--no-session"]),
    );
  });
  it("replies with usage for missing or invalid inputs without starting a model run", async () => {
    const s = setup();
    await s.invoke("");
    await s.invoke("./missing kitchen");
    await s.invoke("./job.txt kitchen");
    expect(s.spawn).not.toHaveBeenCalled();
    const messages = s.ctx.ui.notify.mock.calls.map((call) => call[0]);
    expect(messages[0]).toContain("Usage: /estimates <pastEstimates> <newJob>");
    expect(messages[1]).toContain("pastEstimates not found");
    expect(messages[2]).toContain("pastEstimates must be a folder");
  });
  it("checks file formats", async () => {
    const s = setup({
      inputs: [{ name: "plan", label: "Plan", type: "file", formats: ["pdf"], required: true }],
    });
    await s.invoke("./job.txt");
    expect(s.ctx.ui.notify).toHaveBeenCalledWith("plan must be one of: pdf", "warning");
  });
  it("passes resolved paths and the remaining text through stdin", async () => {
    const s = setup();
    await s.invoke('./past "kitchen remodel," 220 sq ft --bad-option @private');
    expect(s.worker.stdin.end).toHaveBeenCalledWith(
      expect.stringContaining("- pastEstimates (folder): /workspace/past\n- newJob (text): kitchen remodel, 220 sq ft --bad-option @private"),
    );
    expect(args(s).join(" ")).not.toContain("kitchen");
  });
  it("keeps a session between runs in follow-up mode", async () => {
    const s = setup({ conversation: "followUp" });
    await s.invoke("./past kitchen");
    expect(args(s)).toEqual(expect.arrayContaining(["--session-dir", "/home/me/.pi/agent/agent-workers/estimates", "--continue"]));
    expect(args(s)).not.toContain("--no-session");
  });
  it("reports results once and writes file output inside the working directory", async () => {
    const s = setup({ output: { kind: "file", destination: "results/estimate.md" } });
    await s.invoke("./past kitchen");
    s.worker.stdout.emit("data", Buffer.from("Result"));
    s.worker.emit("close", 0);
    s.worker.emit("close", 0);
    expect(s.fs.writeFileSync).toHaveBeenCalledWith("/workspace/results/estimate.md", "Result");
    expect(s.pi.sendMessage).toHaveBeenCalledExactlyOnceWith(
      { customType: "agent-result", content: "Saved the result to results/estimate.md.", display: true },
      { triggerTurn: false },
    );
  });
  it("refuses file output outside the working directory", async () => {
    const s = setup({ output: { kind: "file", destination: "../escape.md" } });
    await s.invoke("./past kitchen");
    s.worker.stdout.emit("data", Buffer.from("Result"));
    s.worker.emit("close", 0);
    expect(s.fs.writeFileSync).not.toHaveBeenCalled();
    expect(s.pi.sendMessage.mock.calls[0][0].content).toContain("Refused");
  });
  it("guards duplicate runs and allows cancellation", async () => {
    const s = setup();
    await s.invoke("./past one");
    await s.invoke("./past two");
    expect(s.spawn).toHaveBeenCalledOnce();
    await s.invoke("cancel");
    expect(s.worker.kill).toHaveBeenCalledWith("SIGTERM");
    s.worker.emit("close", null);
    expect(s.pi.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: "Worker cancelled." }), expect.anything());
  });
  it("terminates on shutdown and suppresses stale results", async () => {
    const s = setup();
    await s.invoke("./past one");
    await s.events.session_shutdown();
    s.worker.emit("close", 0);
    expect(s.worker.kill).toHaveBeenCalled();
    expect(s.pi.sendMessage).not.toHaveBeenCalled();
  });
  it("times out and escalates termination", async () => {
    vi.useFakeTimers();
    const s = setup();
    await s.invoke("./past one");
    await vi.advanceTimersByTimeAsync(302000);
    expect(s.worker.kill).toHaveBeenCalledWith("SIGKILL");
    s.worker.emit("close", null);
    expect(s.pi.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: "Worker timed out after 5 minutes." }), expect.anything());
  });
  it("reports spawn errors", async () => {
    const s = setup();
    await s.invoke("./past one");
    s.worker.emit("error", new Error("ENOENT"));
    expect(s.pi.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: "Could not start pi: ENOENT" }), expect.anything());
  });
  it("parses a proposed email and only allows configured recipients", () => {
    const block = (json: string) => "Findings\n\n```send-email\n" + json + "\n```\n";
    expect(emailProposal("No email here")).toBeUndefined();
    expect(emailProposal(block('{"to":"me@example.com","subject":"Digest\\nx","body":"- AI"}'))).toEqual({ to: "me@example.com", subject: "Digest x", body: "- AI" });
    expect(emailProposal(block("{not json"))).toEqual({ error: "the proposed email is not valid JSON." });
    expect(emailProposal(block('{"to":"me@example.com"}'))).toEqual({ error: "the proposed email needs to, subject and body." });
    expect(allowedRecipients({ skillAnswers: { recipient: "Me@Example.com" } }, { EMAIL_TO: "a@x.com, b@x.com" })).toEqual(["me@example.com", "a@x.com", "b@x.com"]);
  });
  const emailRun = async (to: string, approve = true) => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("EMAIL_FROM", "Bot <bot@example.com>");
    vi.stubEnv("EMAIL_TO", "");
    const send = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", send);
    const s = setup(
      { skillAnswers: { recipient: "me@example.com" }, inputs: [{ name: "topics", label: "Topics", type: "text", formats: [], required: false }] },
      { tools: [], extensions: [], actions: ["send-email"] },
    );
    s.ctx.ui.confirm.mockResolvedValue(approve);
    await s.invoke("");
    s.worker.stdout.emit("data", Buffer.from('Findings\n```send-email\n{"to":"' + to + '","subject":"Digest","body":"- AI news"}\n```'));
    s.worker.emit("close", 0);
    await vi.waitFor(() => expect(s.ctx.ui.notify.mock.calls.length).toBeGreaterThan(1));
    return { s, send };
  };
  it("sends a proposed email only after the user approves it", async () => {
    const { s, send } = await emailRun("me@example.com");
    expect(s.ctx.ui.confirm).toHaveBeenCalledWith("Send this email?", expect.stringContaining("To: me@example.com"));
    expect(send).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse((send.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({
      from: "Bot <bot@example.com>", to: ["me@example.com"], subject: "Digest", text: "- AI news",
    });
    expect(s.ctx.ui.notify).toHaveBeenLastCalledWith("Sent “Digest” to me@example.com.", "info");
  });
  it("doesn't send when the user declines or the recipient isn't configured", async () => {
    const declined = await emailRun("me@example.com", false);
    expect(declined.send).not.toHaveBeenCalled();
    expect(declined.s.ctx.ui.notify).toHaveBeenLastCalledWith("Email not sent.", "info");
    const redirected = await emailRun("attacker@example.com");
    expect(redirected.s.ctx.ui.confirm).not.toHaveBeenCalled();
    expect(redirected.send).not.toHaveBeenCalled();
    expect(redirected.s.ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining("is not the configured recipient"), "warning");
  });
  it("tokenizes quoted arguments", () =>
    expect(tokenize(`./a "b c" 'd' ""`)).toEqual(["./a", "b c", "d", ""]));
});

describe("generated Pi extension", () => {
  const tracker = (kind = "widget") =>
    load(extensionSource, {
      "agent.json": { slug: "agent-tracker", name: "Agent Tracker", description: "Track agents", dataSources: ["session-events"], output: { kind } },
    });
  it("starts on session_start, refreshes on events and toggles without arguments", async () => {
    const s = tracker();
    await s.events.session_start({}, s.ctx);
    expect(s.fs.writeFileSync).toHaveBeenCalledWith(`/tmp/pi-agent-agent-tracker/${process.pid}.json`, expect.stringContaining('"activity":"idle"'));
    await s.events.tool_execution_start({ toolName: "read" });
    expect(s.fs.writeFileSync).toHaveBeenLastCalledWith(expect.any(String), expect.stringContaining('"tool":"read"'));
    expect(s.ctx.ui.setWidget).toHaveBeenLastCalledWith("agent-tracker", expect.arrayContaining([expect.stringContaining("Agent Tracker")]));
    await s.invoke("");
    expect(s.ctx.ui.setWidget).toHaveBeenLastCalledWith("agent-tracker", undefined);
    await s.invoke("show");
    await s.invoke("list");
    expect(s.pi.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ customType: "agent-result" }), { triggerTurn: false });
    await s.events.session_shutdown();
    expect(s.fs.rmSync).toHaveBeenCalledWith(`/tmp/pi-agent-agent-tracker/${process.pid}.json`, { force: true });
    expect(s.ctx.ui.setWidget).toHaveBeenLastCalledWith("agent-tracker", undefined);
    expect(s.ctx.ui.setStatus).toHaveBeenLastCalledWith("agent-tracker", undefined);
  });
  it("uses the status line for status output", async () => {
    const s = tracker("status");
    await s.events.session_start({}, s.ctx);
    expect(s.ctx.ui.setStatus).toHaveBeenCalledWith("agent-tracker", expect.stringContaining("sessions working"));
    expect(s.ctx.ui.setWidget).not.toHaveBeenCalledWith("agent-tracker", expect.any(Array));
    await s.events.session_shutdown();
  });
  it("finds agent processes in ps output", () => {
    const rows = parseProcesses(
      [
        "58419 06-01:27:25 /Users/me/.vscode/extensions/openai.chatgpt/bin/codex -c app-server",
        "  101       01:02 claude --resume",
        "  102       00:10 node /opt/tools/pi --print",
        "  103       00:01 /bin/zsh -zsh",
        "84772       10:00 /Library/Python.app/Contents/MacOS/Python voice_to_claude.py",
        `  ${process.pid} 00:01 pi`,
      ].join("\n"),
      process.pid,
    );
    expect(rows.map((row) => row.trim().split(/\s+/)[2])).toEqual(["codex", "claude", "pi"]);
  });
});

describe("bundled calc tool", () => {
  it.each([
    ["2 + 3 * 4", 14],
    ["(2 + 3) * 4", 20],
    ["220 * 85.5", 18810],
    ["-2 ^ 2", -4],
    ["2 ^ 3 ^ 2", 512],
    ["12000 * 15%", 1800],
    ["10 % 4", 2],
    ["round(18810 * 1.1, 2)", 20691],
    ["avg(10, 20, 30)", 20],
    ["median(4, 1, 3, 2)", 2.5],
    ["min(100, 250) + max(1, 2)", 102],
  ])("evaluates %s", (expression, value) => expect(evaluate(expression)).toBeCloseTo(value));
  it.each(["process.exit()", "1 / 0", "2 +", "constructor", "(1", "1e999"])("rejects %s", (expression) =>
    expect(() => evaluate(expression)).toThrow(),
  );
});

describe("bundled extract tool", () => {
  const tmp = async (name: string, data: Uint8Array) => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const path = join(mkdtempSync(join(tmpdir(), "extract-")), name);
    writeFileSync(path, data);
    return path;
  };
  it("reads DOCX paragraphs", async () => {
    const zip = zipSync({ "word/document.xml": strToU8('<w:document><w:body><w:p><w:r><w:t>Kitchen &amp; bath</w:t></w:r></w:p><w:p><w:r><w:t>220 sq ft</w:t></w:r></w:p></w:body></w:document>') });
    expect(extractText(await tmp("job.docx", zip))).toBe("Kitchen & bath\n220 sq ft");
  });
  it("reads XLSX sheets as CSV with shared strings", async () => {
    const zip = zipSync({
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Jobs" sheetId="1"/></sheets></workbook>'),
      "xl/sharedStrings.xml": strToU8("<sst><si><t>Job</t></si><si><t>Cost, total</t></si></sst>"),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Deck</t></is></c><c r="C2"><v>4200</v></c></row></sheetData></worksheet>'),
    }, { level: 6 });
    expect(extractText(await tmp("jobs.xlsx", zip))).toBe('# Sheet: Jobs\nJob,"Cost, total"\nDeck,,4200');
  });
  it("reads PPTX slides in order", async () => {
    const zip = zipSync({
      "ppt/slides/slide10.xml": strToU8("<p:sld><a:t>Last</a:t></p:sld>"),
      "ppt/slides/slide2.xml": strToU8("<p:sld><a:t>First</a:t></p:sld>"),
    });
    expect(unzip(Buffer.from(zip), () => true).size).toBe(2);
    expect(extractText(await tmp("deck.pptx", zip))).toBe("# Slide 1\nFirst\n\n# Slide 2\nLast");
  });
  it("reads text from compressed PDF content streams", async () => {
    const stream = deflateSync(Buffer.from("BT /F1 12 Tf 72 712 Td (Past job: deck \\(cedar\\)) Tj T* [(Total ) -250 (4200)] TJ ET"));
    const data = Buffer.concat([
      Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length " + stream.length + " /Filter /FlateDecode >>\nstream\n"),
      stream,
      Buffer.from("\nendstream\nendobj\n%%EOF"),
    ]);
    expect(pdf(data)).toBe("Past job: deck (cedar)\nTotal  4200");
  });
  it("explains scanned or unsupported files instead of returning nothing", async () => {
    const scanned = await tmp("scan.pdf", Buffer.from("%PDF-1.4\n%%EOF"));
    expect(() => extractText(scanned)).toThrow("No extractable text");
    const doc = await tmp("old.doc", Buffer.from("x"));
    expect(() => extractText(doc)).toThrow("Unsupported format");
  });
});

describe("bundled web tool", () => {
  it("fetches only public http(s) URLs", () => {
    expect(publicUrl("https://example.com/news").hostname).toBe("example.com");
    for (const url of ["file:///etc/passwd", "http://localhost:3000", "http://127.0.0.1", "http://192.168.1.4", "http://10.0.0.1", "http://[::1]/", "https://user:pw@example.com"])
      expect(() => publicUrl(url)).toThrow();
  });
  it("turns HTML into readable text", () => {
    expect(pageText("<html><head><title>x</title></head><script>bad()</script><p>AI &amp; chips</p><p>Second</p></html>")).toBe("AI & chips\nSecond");
  });
});
describe("embedded templates", () => {
  it("are regenerated from templates/ (run corepack pnpm templates)", () => {
    expect(readFileSync(new URL("./templates.ts", import.meta.url), "utf8")).toBe(renderTemplates());
  });
});
