# Agent Generator Fixes

Oct 19, 2026 · @ian

Both exported agents failed for reasons the generator controls. It writes one hard-coded worker template, drops most selected tools, and passes placeholder text straight through. The changes below fix every agent it produces, not just these two.

## Generation pipeline

Today the generator copies the form into agent.json and writes the same extension file for every agent. It should run these steps instead:

1. **Collect** the task, inputs, outputs and tools from the builder form.
2. **Classify the runtime** from the task wording and the chosen output: a one-shot worker or a long-running extension.
3. **Ask follow-up questions** for anything the chosen template needs that the form left blank: data source, file location, method, output format.
4. **Write agent.json v3** with no placeholder text in any field.
5. **Validate** that every tool resolves, every input format is readable and every required field is filled. Any error stops the export.
6. **Emit** from the chosen template. Worker flags come from the tool registry, not from hard-coded checks.
7. **Self-test** by typechecking the extension and dry-running the command before handing over the zip.

## Spec changes (agent.json v3)

The spec needs fields the templates can act on. Free-text chips like "Files & documents" give the code nothing to wire up.

| Field | Today | Change |
| --- | --- | --- |
| `runtime` | Missing; every agent is a one-shot worker | `"worker"` or `"extension"`, set in step 2 |
| `inputs` | `startsWith` free text, e.g. "The input described in the task" | Typed list: `{name, type: folder / file / text / connection, formats, required}`. Each one becomes a command argument |
| `output` | `format: "markdown"` only | `kind`: chat-message, file, widget, status or overlay, plus `template` (the sections the result must have) |
| `tools` | Ids the code mostly ignores | Ids looked up in the tool registry. An unknown id is an export error |
| `method` | Missing | Numbered steps the agent follows. Required for analysis agents |
| `dataSources` | `connections: []`; nothing wired | Named sources the template wires up: `session-events`, `process-list`, `files:<path>`, `connection:<name>` |
| `conversation` | Missing; the worker runs `--no-session` | `oneShot` (lists missing inputs and assumptions, never asks) or `followUp` (keeps a session between runs) |
| `skill.whenToUse` | SKILL.md is a copy of the instructions | One line saying when the main agent should use this agent |

## Runtime choice

The generator needs two templates, and the spec decides which one is emitted. The current file stays as the worker template.

|  | Worker (today's template) | Extension (new) |
| --- | --- | --- |
| Use when | The job is ask once, answer once: drafts, estimates, summaries | The job watches or shows live state: trackers, dashboards, monitors |
| How it runs | `/slug <args>` starts `pi --print`, waits, posts one message | Starts on `session_start`, keeps running until `session_shutdown` |
| Output | `pi.sendMessage` once | `ctx.ui.setWidget` / `setStatus`, refreshed on events and timers |
| Data | Granted tools inside the worker | `pi.on(...)` events, process scans, shared files, `pi.events` |
| Command | Requires arguments | No arguments toggles it; `show`, `hide`, `list` |
| Limits | 5-minute timeout, 1 MB output | No timeout; clears timers, widget and files on shutdown |

**Rule:** choose the extension when the output kind is widget, status or overlay, or when the task uses words like *track, monitor, watch, live, dashboard, status, panel* or *in the terminal*. Otherwise choose the worker. If the signals conflict, ask the builder user instead of guessing.

## Tool registry

Today only `read-files` changes the worker's flags (the `canRead` check). Every other tool id is dropped silently but still listed in instructions.md. Replace that check with a registry that every id must resolve through:

| Tool id | Grants | Wiring |
| --- | --- | --- |
| `read-files` | Read, list and search files in the working directory | `--tools read,grep,find,ls` |
| `analyze-data` | Real calculation | A bundled sandboxed `calc` tool. Never a prompt-only promise |
| `extract-documents` | PDF, Excel and Word as text | A bundled extract tool, or conversion before the worker starts |
| `draft-text`, `plan-tasks` | Nothing extra | No flag. Remove from the tool list and describe the behavior in the method |
| `skill:<repo>/<name>` | An external skill | Bundle the skill and drop `--no-skills` for it, or fail the export |
| `session-events`, `process-list` | Live data (extension only) | Wired by the extension template |

The generator merges registry entries into one flag set. instructions.md lists only tools that were actually granted.

## Inputs and files

Inputs should be arguments the command checks, not text the worker has to interpret.

- **Each input becomes a command argument,** for example `/estimates ./past-jobs "kitchen remodel, 220 sq ft"`. The template passes paths to the worker explicitly.
- **A missing required input gets a usage reply** from the command itself, without starting a model run.
- **File inputs declare their formats.** Pi's `read` tool only handles text files and images. When the formats include PDF, .xlsx or .docx, the generator adds `extract-documents` automatically.
- **Conversation mode decides how gaps are handled.** In `oneShot` mode the instructions say "list missing inputs and your assumptions in the result" instead of "ask for missing inputs", because a `--print` worker cannot wait for an answer.

## Instructions and skill files

instructions.md and SKILL.md are both copies of the form today. Each should be generated for its own reader.

- **instructions.md (the worker's system prompt)** is built from the task, method, output template and granted tools. It never mentions tools the worker doesn't have.
- **Analysis agents need a method.** When the category is information-analysis or `analyze-data` is selected, require numbered steps and offer a default per category. For estimates: find comparable past jobs, convert to per-unit rates, adjust for scope, add contingency, give a range.
- **The output template lists required sections.** For an estimate: line items, assumptions, past jobs used, confidence range.
- **SKILL.md is for the main agent.** Its description says when to use this agent, and its body says how to call the command. It does not repeat the task text, which can pull the main agent into doing the job itself.
- **Extension agents may skip the skill,** or use it only to explain the commands and where the data lives.

## Export checks

Each check below stops the export and shows the builder user the message. Both broken agents would have been caught.

| Check | Error shown to the builder user |
| --- | --- |
| A field still has template text ("The input described in the task", "A designed interface", "Files & documents") | Describe the actual input / output instead of the placeholder |
| Tool id not in the registry | `<id>` isn't a tool this exporter can supply |
| Tool listed in instructions but missing from the worker's flags | `<id>` was selected but isn't wired up |
| Output kind is widget, status or overlay but runtime is worker | This output needs the extension runtime |
| Task says track / monitor / live but no `dataSources` | Where should this agent get its live data? |
| Input format isn't readable with the granted tools | Add `extract-documents` to read `<format>` files |
| Instructions say "ask" in `oneShot` mode | One-shot agents can't ask; list missing inputs instead |
| Analysis agent without a method | Add the steps this agent should follow |
| Generated extension fails to typecheck | Show the compiler error and don't ship the zip |

## Regression tests

Feed both original form inputs back through the fixed generator. Each should either produce the agent below or stop with the listed error.

| Case | Expected spec | Must fail if |
| --- | --- | --- |
| Agent Tracker ("track the agents … give a UI in the CLI") | `runtime: extension`, `dataSources: [session-events, process-list]`, `output.kind: widget`, no-argument toggle command | It comes out as a worker, or with no data source |
| Estimates ("previous plans and estimates … generate an estimate") | `runtime: worker`, tools `read-files` + `extract-documents` + `analyze-data`, inputs `pastEstimates` (folder) and `newJob` (text), `conversation: oneShot`, method and output template filled | `analyze-data` has no calc tool, PDF/Excel inputs can't be read, or the method is empty |

- [ ] Add both cases as fixtures in the generator's test suite
- [ ] Typecheck each generated extension against `@earendil-works/pi-coding-agent`
- [ ] Install each generated package in Pi and run its command once
