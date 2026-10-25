// Worker template: `/slug <args>` starts a separate `pi --print` run, waits, posts one message.
// Generated from agent.json and worker.json; flags come from the exporter's tool registry.
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Input {
  name: string;
  label: string;
  type: 'folder' | 'file' | 'text' | 'connection';
  formats: string[];
  required: boolean;
}
interface Spec {
  slug: string;
  name: string;
  description: string;
  inputs: Input[];
  conversation: 'oneShot' | 'followUp';
  output: { kind: string; destination: string };
}
interface WorkerConfig {
  tools: string[];
  extensions: string[];
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote = '';
  let started = false;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) tokens.push(current);
  return tokens;
}

export function usage(spec: Spec): string {
  const args = spec.inputs.map((input) => (input.required ? '<' + input.name + '>' : '[' + input.name + ']'));
  const lines = spec.inputs.map(
    (input) =>
      '  ' + input.name + ' (' + input.type + (input.formats.length ? ': ' + input.formats.join(', ') : '') + '): ' + input.label,
  );
  return ['Usage: /' + spec.slug + ' ' + args.join(' '), ...lines, 'Quote values that contain spaces. Use /' + spec.slug + ' cancel to stop.'].join('\n');
}

/** Maps command arguments to declared inputs. The last text input takes the remaining words. */
export function parseInputs(spec: Spec, raw: string, cwd: string): { values: Record<string, string> } | { error: string } {
  const tokens = tokenize(raw);
  const values: Record<string, string> = {};
  let index = 0;
  spec.inputs.forEach((input, position) => {
    if (index >= tokens.length) return;
    const rest = position === spec.inputs.length - 1 && input.type === 'text';
    values[input.name] = rest ? tokens.slice(index).join(' ') : tokens[index];
    index = rest ? tokens.length : index + 1;
  });
  if (index < tokens.length) return { error: 'Too many arguments.\n' + usage(spec) };
  for (const input of spec.inputs) {
    const value = values[input.name];
    if (!value) {
      if (input.required) return { error: 'Missing ' + input.name + '.\n' + usage(spec) };
      continue;
    }
    if (input.type !== 'file' && input.type !== 'folder') continue;
    const path = resolve(cwd, value);
    let kind: 'file' | 'folder' | undefined;
    try {
      const stats = statSync(path);
      kind = stats.isDirectory() ? 'folder' : stats.isFile() ? 'file' : undefined;
    } catch {
      return { error: input.name + ' not found: ' + value };
    }
    if (kind !== input.type) return { error: input.name + ' must be a ' + input.type + ': ' + value };
    const extension = extname(path).slice(1).toLowerCase();
    if (input.type === 'file' && input.formats.length && !input.formats.includes(extension))
      return { error: input.name + ' must be one of: ' + input.formats.join(', ') };
    values[input.name] = path;
  }
  return { values };
}

export default function (pi: ExtensionAPI) {
  const spec = JSON.parse(readFileSync(new URL('../agent.json', import.meta.url), 'utf8')) as Spec;
  const config = JSON.parse(readFileSync(new URL('../worker.json', import.meta.url), 'utf8')) as WorkerConfig;
  const instructions = fileURLToPath(new URL('../instructions.md', import.meta.url));
  const sessions = join(homedir(), '.pi', 'agent', 'agent-workers', spec.slug);
  let child: ChildProcess | undefined;
  let generation = 0;
  let cancel: (() => void) | undefined;
  pi.on('session_shutdown', async () => {
    generation++;
    cancel?.();
  });
  pi.registerCommand(spec.slug, {
    description: spec.description + ' (cancel stops a run)',
    handler: async (raw: string, ctx: ExtensionCommandContext) => {
      const command = raw.trim();
      if (command === 'cancel') {
        cancel?.();
        return;
      }
      if (command === 'help') {
        ctx.ui.notify(usage(spec), 'info');
        return;
      }
      if (command === 'reset' && spec.conversation === 'followUp') {
        rmSync(sessions, { recursive: true, force: true });
        ctx.ui.notify(spec.name + ' will start a new conversation next run.', 'info');
        return;
      }
      if (child) {
        ctx.ui.notify('Already running. Use /' + spec.slug + ' cancel.', 'warning');
        return;
      }
      // Missing or invalid inputs get a usage reply without starting a model run.
      const parsed = parseInputs(spec, command, ctx.cwd);
      if ('error' in parsed) {
        ctx.ui.notify(parsed.error, 'warning');
        return;
      }
      // Read-only worker: no shell, writes, app connections or inherited extensions.
      const args = ['--print', '--no-extensions', '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-approve', '--system-prompt', instructions];
      args.push(...(spec.conversation === 'followUp' ? ['--session-dir', sessions, '--continue'] : ['--no-session']));
      for (const extension of config.extensions) args.push('--extension', fileURLToPath(new URL('../' + extension, import.meta.url)));
      args.push(...(config.tools.length ? ['--tools', config.tools.join(',')] : ['--no-tools']));
      if (ctx.model) args.push('--provider', ctx.model.provider, '--model', ctx.model.id);
      if (spec.conversation === 'followUp') mkdirSync(sessions, { recursive: true });
      const worker = spawn('pi', args, { cwd: ctx.cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
      child = worker;
      const runGeneration = generation;
      let output = '';
      let errors = '';
      let failure = '';
      let finished = false;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        worker.kill('SIGTERM');
        killTimer ??= setTimeout(() => worker.kill('SIGKILL'), 2000);
        killTimer.unref?.();
      };
      cancel = () => {
        failure = 'Worker cancelled.';
        stop();
      };
      const timer = setTimeout(() => {
        failure = 'Worker timed out after 5 minutes.';
        stop();
      }, 300000);
      const deliver = (text: string) => {
        if (spec.output.kind !== 'file') return text;
        const root = resolve(ctx.cwd);
        const target = resolve(root, spec.output.destination);
        if (!target.startsWith(root + sep)) return 'Refused to write outside the working directory.\n\n' + text;
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, text);
        return 'Saved the result to ' + relative(root, target) + '.';
      };
      const finish = (error?: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        child = undefined;
        cancel = undefined;
        if (generation !== runGeneration) return;
        ctx.ui.setStatus(spec.slug, undefined);
        let content = error || output || 'Worker returned no output.';
        if (!error && output) {
          try {
            content = deliver(output);
          } catch (writeError) {
            content = 'Could not save the result: ' + (writeError as Error).message + '\n\n' + output;
          }
        }
        pi.sendMessage({ customType: 'agent-result', content, display: true }, { triggerTurn: false });
      };
      worker.stdout?.on('data', (chunk: Buffer) => {
        if (output.length + chunk.length > 1000000) {
          failure = 'Worker output exceeded 1 MB.';
          stop();
        } else output += chunk.toString();
      });
      worker.stderr?.on('data', (chunk: Buffer) => {
        errors = (errors + chunk.toString()).slice(-4000);
      });
      worker.on('error', (error) => finish('Could not start pi: ' + error.message));
      worker.on('close', (code) => finish(failure || (code === 0 ? undefined : 'Worker failed: ' + errors)));
      worker.stdin?.on('error', () => {
        /* Process errors are reported by close/error. */
      });
      // stdin keeps user text out of CLI option, slash-command and @file parsing.
      const lines = spec.inputs
        .filter((input) => parsed.values[input.name])
        .map((input) => '- ' + input.name + ' (' + input.type + '): ' + parsed.values[input.name]);
      worker.stdin?.end('Complete this task using your agent instructions.\n\nInputs:\n' + lines.join('\n') + '\n');
      ctx.ui.setStatus(spec.slug, 'Working: ' + spec.name);
      ctx.ui.notify(spec.name + ' is working in the background (read-only).', 'info');
    },
  });
}
