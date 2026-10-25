// Extension template: starts on session_start and shows live state until session_shutdown.
// Data sources come from agent.json: session-events, process-list and files:<path>.
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

interface Spec {
  slug: string;
  name: string;
  description: string;
  dataSources: string[];
  output: { kind: 'widget' | 'status' | string };
}
interface Peer {
  pid: number;
  cwd: string;
  activity: string;
  tool: string;
  toolCalls: number;
  updatedAt: number;
}
const REFRESH_MS = 5000;
const STALE_MS = 60000;
const AGENT_COMMANDS = /^(?:pi|claude|codex|cursor-agent|aider|gemini|opencode|goose|amp|crush|qwen)$/;

/** Parses `ps -axo pid=,etime=,args=` and keeps known agent CLIs (direct or run through node/bun). */
export function parseProcesses(text: string, ownPid: number): string[] {
  const rows: string[] = [];
  for (const line of text.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/);
    if (!match || Number(match[1]) === ownPid) continue;
    const [, pid, elapsed, args] = match;
    const words = args.split(/\s+/);
    const first = basename(words[0]);
    const second = basename(words[1] || '');
    const agent = AGENT_COMMANDS.test(first) ? first : /^(?:node|bun|deno)$/.test(first) && AGENT_COMMANDS.test(second) ? second : undefined;
    if (agent) rows.push(pid.padStart(6) + '  ' + elapsed.padStart(11) + '  ' + agent + ' ' + words.slice(agent === first ? 1 : 2).join(' ').slice(0, 60));
  }
  return rows.slice(0, 20);
}

export function tail(path: string, lines = 5): string[] {
  const size = statSync(path).size;
  const length = Math.min(size, 65536);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return buffer.toString('utf8').split('\n').filter(Boolean).slice(-lines);
}

export default function (pi: ExtensionAPI) {
  const spec = JSON.parse(readFileSync(new URL('../agent.json', import.meta.url), 'utf8')) as Spec;
  const sources = new Set(spec.dataSources);
  const filePaths = spec.dataSources.filter((source) => source.startsWith('files:')).map((source) => source.slice(6));
  const shared = join(tmpdir(), 'pi-agent-' + spec.slug);
  const own = join(shared, process.pid + '.json');
  const state = { activity: 'idle', tool: '', toolCalls: 0 };
  let context: ExtensionContext | undefined;
  let visible = true;
  let timer: ReturnType<typeof setInterval> | undefined;
  let scan: ChildProcess | undefined;
  let processes: string[] = [];
  let peers: Peer[] = [];
  let files: string[] = [];

  const heartbeat = () => {
    if (!sources.has('session-events') || !context) return;
    try {
      mkdirSync(shared, { recursive: true });
      writeFileSync(own, JSON.stringify({ pid: process.pid, cwd: context.cwd, ...state, updatedAt: Date.now() }));
    } catch {
      /* Shared state is best effort; the local view still works. */
    }
  };
  const readPeers = () => {
    if (!sources.has('session-events')) return;
    const now = Date.now();
    const next: Peer[] = [];
    let entries: string[] = [];
    try {
      entries = readdirSync(shared);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      try {
        const peer = JSON.parse(readFileSync(join(shared, entry), 'utf8')) as Peer;
        if (now - peer.updatedAt < STALE_MS) next.push(peer);
      } catch {
        /* Skip files another session is writing. */
      }
    }
    peers = next.sort((a, b) => a.pid - b.pid);
  };
  const scanProcesses = () => {
    if (!sources.has('process-list') || scan || process.platform === 'win32') return;
    let text = '';
    const child = spawn('ps', ['-axo', 'pid=,etime=,args='], { shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    scan = child;
    const kill = setTimeout(() => child.kill('SIGKILL'), 4000);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (text.length < 1000000) text += chunk.toString();
    });
    child.on('error', () => {
      clearTimeout(kill);
      scan = undefined;
    });
    child.on('close', () => {
      clearTimeout(kill);
      scan = undefined;
      processes = parseProcesses(text, process.pid);
      render();
    });
  };
  const readFiles = () => {
    if (!context) return;
    const next: string[] = [];
    for (const path of filePaths) {
      const target = resolve(context.cwd, path);
      try {
        const stats = statSync(target);
        if (stats.isDirectory()) next.push(path + ': ' + readdirSync(target).length + ' entries');
        else next.push(path + ':', ...tail(target).map((line) => '  ' + line.slice(0, 100)));
      } catch {
        next.push(path + ': not found');
      }
    }
    files = next;
  };
  const summary = () => {
    const parts: string[] = [];
    if (sources.has('session-events')) parts.push(peers.filter((peer) => peer.activity === 'working').length + '/' + peers.length + ' sessions working');
    if (sources.has('process-list')) parts.push(processes.length + ' agent processes');
    if (filePaths.length) parts.push(filePaths.length + ' files watched');
    return spec.name + ': ' + (parts.join(' · ') || 'no data sources');
  };
  const lines = () => {
    const out = [summary()];
    if (sources.has('session-events'))
      for (const peer of peers)
        out.push((peer.pid === process.pid ? '* ' : '  ') + String(peer.pid).padStart(6) + '  ' + peer.activity.padEnd(7) + '  ' + (peer.tool || '-').padEnd(12) + '  ' + peer.toolCalls + ' tools  ' + basename(peer.cwd));
    if (sources.has('process-list')) out.push(...(process.platform === 'win32' ? ['  Process list is not available on Windows.'] : processes.map((row) => '  ' + row)));
    out.push(...files);
    return out;
  };
  function render() {
    if (!context?.hasUI) return;
    if (!visible) {
      context.ui.setWidget(spec.slug, undefined);
      context.ui.setStatus(spec.slug, undefined);
    } else if (spec.output.kind === 'status') context.ui.setStatus(spec.slug, summary());
    else context.ui.setWidget(spec.slug, lines());
  }
  const refresh = () => {
    heartbeat();
    readPeers();
    readFiles();
    scanProcesses();
    render();
  };
  const update = (patch: Partial<typeof state>) => {
    Object.assign(state, patch);
    refresh();
  };

  pi.on('session_start', async (_event, ctx) => {
    context = ctx;
    if (!timer) {
      timer = setInterval(refresh, REFRESH_MS);
      timer.unref?.();
    }
    refresh();
  });
  if (sources.has('session-events')) {
    pi.on('agent_start', async () => update({ activity: 'working' }));
    pi.on('agent_end', async () => update({ activity: 'idle', tool: '' }));
    pi.on('tool_execution_start', async (event) => update({ tool: event.toolName, toolCalls: state.toolCalls + 1 }));
    pi.on('tool_execution_end', async () => update({ tool: '' }));
  }
  pi.on('session_shutdown', async () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    scan?.kill('SIGKILL');
    scan = undefined;
    rmSync(own, { force: true });
    if (context?.hasUI) {
      context.ui.setWidget(spec.slug, undefined);
      context.ui.setStatus(spec.slug, undefined);
    }
    context = undefined;
  });
  pi.registerCommand(spec.slug, {
    description: spec.description + ' (no arguments toggles; show, hide, list)',
    getArgumentCompletions: (prefix: string) =>
      ['show', 'hide', 'list'].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
    handler: async (raw: string, ctx) => {
      context = ctx;
      const command = raw.trim();
      if (!command) visible = !visible;
      else if (command === 'show') visible = true;
      else if (command === 'hide') visible = false;
      else if (command === 'list') {
        refresh();
        pi.sendMessage({ customType: 'agent-result', content: lines().join('\n'), display: true }, { triggerTurn: false });
        return;
      } else {
        ctx.ui.notify('Usage: /' + spec.slug + ' [show|hide|list]', 'warning');
        return;
      }
      refresh();
    },
  });
}
