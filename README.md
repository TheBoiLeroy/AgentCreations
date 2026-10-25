# Agent Creations

An agent workshop built around the five original `agent-icons` categories. Create a neutral spec, save it locally, then download a portable skill or a Pi package. A separate, self-hosted MCP service can run the same spec with your own Anthropic key.

## Run the website

Requires Node.js 22+ and Corepack (or pnpm 10).

```sh
corepack pnpm install
corepack pnpm dev
```

Open http://127.0.0.1:3000. No API key or account is required for the builder and exports.

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm exec playwright install chromium
corepack pnpm test:e2e
corepack pnpm build
```

## What works

- Reducer-driven creation flow: animated category → name → needs → Jev reading → advised skills → follow-up details → review/create → install. Back keeps answers; refresh starts a fresh build at step one.
- Original animated SVGs imported with SVGR, a shared-layout avatar, direction-aware slide/fade transitions, dark mode and reduced-motion support.
- Automatically generated unique triggers, editable tool selections with reasons/confidence, and catalog-owned approval requirements.
- Jev rules for chips and whole-word keywords, plus an optional server-only model pass with an eight-second fallback.
- Local recovery, an optional Supabase `agent_builds` backend, serialized PATCH saves, owner-scoped RLS, revision conflict checks, and a unique `(user_id, trigger)` index.
- Created-agent library, v1/v2/v3 JSON import, skill ZIPs, Pi package ZIPs, install instructions and first-task prompts.
- Strict v3 Zod schema (with v1/v2 import migrations); JSON Schema available at `/api/schema`. v3 adds `runtime`, typed `inputs`, `output.kind`/`template`, `method`, `dataSources`, `conversation` and `skill.whenToUse`.
- Generator pipeline: classify the runtime (one-shot worker or long-running extension), ask follow-up questions for anything the template needs, write v3 with no placeholder text, run export checks, and emit from the chosen template. Any export check stops the download and shows the reason.
- Pi, Claude Code and Codex local install adapters. Cursor remote MCP configuration. Honest setup requirements for Claude app and ChatGPT.
- Two self-contained Pi templates. The worker starts a separate read-only Pi process from `/slug <args>` and reports one result without blocking the main conversation (cancellation, five-minute timeout, output limit, shutdown cleanup). The extension starts on `session_start` and refreshes a widget or status line from session events, a process scan and watched files until `session_shutdown`.
- Official MCP SDK Streamable HTTP server with bearer authentication, host checks, request limits, concurrency limits, fresh spec loading and Anthropic execution.

## Layout

- `apps/web` — Next.js / React / Tailwind / Framer Motion website and draft/Jev APIs. SVGR imports directly from root `agent-icons`, the only asset source.
- `packages/spec` — schemas, draft shape, category metadata, trigger helpers, v1/v2 migration, target-independent export checks and the portable prompt renderer.
- `packages/jev` — catalog, chips, rules, optional-model orchestration and spec assembly.
- `supabase/migrations` — owner-scoped draft table and atomic save/trigger-allocation transaction. SQL is tested with an embedded Postgres engine (PGlite).
- `packages/exporters` — pure spec-to-files adapters, ZIP creation and installation guidance.
- `packages/pi-runner` — standalone extension source included in each exported package.
- `apps/mcp-server` — single-owner hosted runtime; no cloud infrastructure is created by the website.
- `tests/e2e` — desktop and mobile builder tests.

## Propose-and-correct redesign (in progress)

The replacement flow in `docs/Agent Builder Propose-and-Correct Spec.md` is not yet
available in the website. Its first core primitives—data contracts, safe condition
evaluation, output-template validation, JSON Schema generation, and atomic template
edits—live in `packages/spec/src/propose` (`@agents/spec/propose`). Existing v3
imports and exports are unchanged. See [implementation status and remaining core
work](docs/propose-and-correct-implementation.md) before continuing the rollout.

## Configure the new creation flow

The new flow runs without any services: drafts recover from local storage and Jev uses deterministic rules. To enable cloud drafts, copy `apps/web/.env.example` to `apps/web/.env.local`, set `SUPABASE_URL` and `SUPABASE_ANON_KEY`, apply `supabase/migrations/202610180001_agent_builds.sql` through your Supabase migration process, and enable anonymous sign-ins in Supabase Auth. Restart Next.js after changing environment variables. Use the anon/publishable key, not the service-role key; RLS must remain active.

The server creates an anonymous user on the first build POST, stores the session in HTTP-only cookies, and scopes every read/write to that owner. `POST /api/agent-builds` creates a draft; `PATCH /api/agent-builds/:id` saves a validated snapshot plus the expected revision. Page changes save immediately; text edits debounce for 450 ms. Requests are serialized and revisions increase after each successful write. A database transaction reserves the trigger when the name is saved, adds suffixes for collisions, and applies the same trigger to the final spec. Cloud-backed uniqueness is authoritative; local-only uniqueness covers created agents on that device.

`GET /api/agent-builds/:id` reloads a draft; `GET /api/agent-builds` lists the most recent 100 builds for that browser session. A local recovery snapshot is retained even with cloud sync. Opening or refreshing the page starts a new build at step one rather than automatically restoring a local or cloud draft. On conflict, the UI preserves the local answers and offers retry or an explicit cloud reload rather than overwriting. Clearing both cookies and local storage loses access to an anonymous account; download JSON backups. Cross-device identity requires a future account-linking flow.

To enable Jev's optional model pass, set `JEV_API_KEY` (an Anthropic API key) and `JEV_MODEL` in the same server environment. Never prefix either with `NEXT_PUBLIC_`. `POST /api/jev` always runs rules, and only calls the model for at least 12 trimmed characters of free text. Catalog-only model picks are merged with rules, not substituted for chip picks. Invalid output, provider failure or an eight-second deadline falls back to rules. The browser also falls back if the route is unreachable. The model sees the category, chip IDs and free-text description, so keep secrets out of those fields.

The optional Jev route has a per-process enhancement budget of 20 calls/minute and three concurrent model calls. Rules remain available when that budget is exhausted. For public multi-instance hosting, add authenticated user quotas and shared rate limiting before enabling a paid key. Recommendations describe capabilities; they do not connect accounts or change the Pi/MCP runtime's permissions.

## Jev’s skills.sh catalog

Jev also recommends a curated set of external skills listed on [skills.sh](https://skills.sh/): Anthropic’s PDF, Excel, PowerPoint, frontend-design and webapp-testing skills, plus Vercel’s React best-practices skill. Whole-word/phrase rules and the optional model can suggest them; slide deck, Excel file and interface output chips select relevant skills explicitly. Users can toggle them like other catalog entries.

The skills step searches the curated catalog by name, description and ID, with Research, Communication, Files, Data and Dev filters. Suggested skills stay first and selected by default; catalog results load incrementally without a total display cap. Filtering never changes selections. This is not a live search of the synchronized skills.sh index.

Cards link to the source listing and show a manual `npx skills add <repository> --skill <name>` command. Selected entries retain repository/skill metadata in v2 JSON and setup guidance in exported prompts. Existing v2 specs without this optional metadata remain valid. The catalog is checked in, not live search; builder text is not sent to skills.sh. Source listings, popularity and repository reputation were checked when adding the entries, but this is not a security audit or endorsement of future upstream changes.

External skill content is **not downloaded, bundled, or automatically installed**. Review the upstream instructions, license, scripts and dependencies before manually installing into a compatible host. These entries conservatively require approval before changes. Selection neither provisions dependencies nor expands runtime permissions: the read-only Pi worker and text-only MCP runtime cannot execute these skills’ file-writing, shell or browser workflows.

### Skill-driven research/email setup

A description such as “research a topic and email me” now preselects web search and sending and asks for topics and recipient, rather than generic technical input definitions. This guided path covers web-search/send-email combinations plus drafting/planning/review behaviors; other skills retain the existing details form. Permissions are displayed before review. Model-dependent skills force automatic runtime inference to worker, and incompatible extension overrides are blocked before export. Runtime overrides and live watch/display settings are collapsed.

Pi exports of that path work without extra installs. `web-search` bundles `web_search`/`fetch_page` tools (Brave Search API via `BRAVE_API_KEY`; public http(s) pages only). `send-email` is an approval-gated action: the read-only worker ends its result with a `send-email` JSON block, Pi asks the user to confirm, and the command sends through Resend (`RESEND_API_KEY`, `EMAIL_FROM`) only to the configured recipient or `EMAIL_TO`. Mailbox, CRM and calendar tools still stop the Pi export with a reason, because Pi packages can't supply connections.

Drafts default missing `details.skillAnswers` to `{}`. New v3 exports optionally carry `skillAnswers`, with the configured values also rendered as data in their instructions; existing imports remain valid. Every curated catalog entry now exposes the skill metadata contract in `packages/spec/src/skills.ts`. This does not migrate the separate synchronized catalog or enable custom/imported skill creation.

Empty skill searches offer an operational **Request it** action. Apply `supabase/migrations/202610250001_skill_requests.sql` after configuring Supabase auth. It records one normalized search term per authenticated browser owner with RLS; maintainers can aggregate `count(*)` grouped by `search_term` using an administrative database connection. The public API cannot read other owners’ requests. Without cloud configuration, requests fail visibly rather than pretending to save.

Custom-skill generation, GitHub/MCP import and real test runs are **not implemented**. The disabled test-send control explains the missing execution service. No mailbox is connected, no email is sent, and no skill is marked tested. See `docs/skill flow exe.md` for implementation status and remaining work.

### Maintained catalog rollout

The stage-one backend foundation for a synchronized skills.sh catalog is now available: a staged index with atomic publication, maintainer-only synchronization/curation APIs, revision conflicts, and an audit trail. It does **not yet replace Jev’s bundled recommendations**, schedule daily refreshes, or provide a catalog-management UI. See [catalog setup, API operations, and remaining rollout work](docs/skill-catalog.md). The migration has SQL-engine tests but has not been applied to a live Supabase project.

## Local installation

Choose a tool on the last builder screen, download its ZIP, and run the displayed command in your downloads directory. Worker packages contain `package.json`, `agent.json`, `worker.json` (flags from the tool registry), `instructions.md` (the worker's prompt), `extensions/agent.ts`, `skills/<slug>/SKILL.md` (tells the main agent when to suggest the command) and any bundled worker tools in `tools/`. Extension packages contain only `package.json`, `agent.json`, `extensions/agent.ts` and a README.

Pi 1.1+ discovers `extensions` and `skills` through the generated manifest. It provides `@earendil-works/pi-coding-agent` and `typebox` to extensions. No unpublished `@yoursite` package, npm dependency or shared runner installation is needed.

After installing, restart Pi. Workers run as `/<slug> <input> …`: each declared input is a positional argument (quote values with spaces); missing or invalid inputs get a usage reply without a model run. Use `/<slug> cancel` to stop the worker. It uses the active model selection and the user's Pi credentials. Worker tools come only from `packages/exporters/src/registry.ts`: `read-files` grants `read,grep,find,ls`, `analyze-data` bundles a `calc` arithmetic tool, and `extract-documents` bundles a dependency-free PDF/DOCX/XLSX/PPTX text extractor (scanned PDFs return an explanation, not text). Any other tool id, including external skills, stops the Pi export. Workers have no shell, write tools, MCP, or inherited extensions; with `output.kind: "file"` the command (not the worker) writes the result inside the working directory. Extensions take `/<slug>` (toggle), `show`, `hide` and `list`; they share session heartbeats through files in the OS temp directory and remove them on shutdown. It is **not a filesystem sandbox**: the Pi process still runs with your OS permissions. It cannot perform web requests or app actions. Requests needing those capabilities should be completed in an appropriately configured interactive tool.

Skill approval boundaries are prompt instructions, not enforced security controls. Review exported instructions before installing. Do not put API keys, passwords or tokens in builder fields; everything entered there is included in downloadable files and browser storage.

## Run the hosted MCP route

This is a **single-owner, text-only self-hosted runtime**, not a multi-user hosted product. The operator supplies and pays for the Anthropic key. The builder's optional Jev route can make separate tool-recommendation calls when `JEV_API_KEY` and `JEV_MODEL` are configured; it never executes the agent's task.

1. Download Agent JSON and save it as `agents/<slug>.json` under this repository.
2. Copy `.env.example` to `.env`. Set `ANTHROPIC_API_KEY`, an available `ANTHROPIC_MODEL`, and a random `MCP_AUTH_TOKEN` of at least 32 characters (for example, `openssl rand -hex 32`).
3. Start the service:

   ```sh
   node --env-file=.env --import tsx apps/mcp-server/src/index.ts
   ```

4. Connect an MCP client to `http://127.0.0.1:3001/agents/<slug>/mcp` with `Authorization: Bearer <MCP_AUTH_TOKEN>`. The protocol is stateless Streamable HTTP, POST only. GET/SSE reconnection and DELETE return 405.
5. For remote use, terminate HTTPS at your reverse proxy, set `MCP_ALLOWED_HOSTS` to the public hostname, and set `HOST=0.0.0.0` if appropriate. Never expose the service without authentication and TLS.

The only model tool is named after the agent's slug and accepts `{ "task": "..." }`. Include any file content in that task: the hosted runtime has no filesystem, browsing, Gmail or CRM tools. An instructions resource is also available. Each request reloads the JSON spec, so an atomic file replacement updates the next request without restarting. Editing a browser-local agent alone does not deploy it.

The bearer token authenticates access to the server; the Anthropic key remains in the server environment. Browser-origin requests are intentionally rejected. Cursor and other clients supporting bearer headers can connect. **Claude app and ChatGPT may require OAuth rather than custom headers; OAuth is not implemented**, so their chips explain the limitation instead of claiming a ready connection.

The service limits requests to 60/minute and model calls to three concurrent requests per process. These controls are for a small single-process deployment, not distributed production quotas. Model calls time out after 90 seconds and return at most 4096 tokens. Provider failures are sanitized before reaching the client.

### Docker

From the repository root:

```sh
docker build -f apps/mcp-server/Dockerfile -t agent-creations-mcp .
docker run --rm -p 127.0.0.1:3001:3001 --env-file .env \
  -e HOST=0.0.0.0 -e AGENTS_DIRECTORY=/data/agents \
  -v "$PWD/agents:/data/agents:ro" agent-creations-mcp
```

## Deliberate scope boundaries

Supabase draft persistence and anonymous server-side authentication are now implemented, but this repository has no configured cloud credentials or deployed migration. Without configuration the UI explicitly uses device-only storage. Anonymous auth identifies this browser; cross-device account login/linking, app OAuth connections, billing, generated-file cloud storage, npm publishing automation and automatic deployment remain outside this round. The UI uses native accessible controls rather than adding a shadcn component layer.

To distribute an exported Pi package through npm, choose a package name/scope you own, review the generated code, update its manifest, and publish explicitly. Only then advertise `pi install npm:@your-scope/<agent>`. Local package changes require replacing exported files; npm/git updates depend on the installed version/ref. See `Agent Integration Plan.md` for the broader product direction.

## Verification scope

Vitest covers schemas/migration, trigger collisions, Jev chip/keyword/default/model/timeout behavior, reducer navigation, API validation, exporters, the tool registry and export checks, generated worker/extension lifecycles, the bundled calc and extract tools, regression fixtures for the original Agent Tracker and Estimates forms (including a typecheck of both generated packages against `@earendil-works/pi-coding-agent`) and real MCP protocol exchanges with a mocked model. PGlite executes the actual SQL migration and tests RLS ownership, unique triggers, revision conflicts and saved-spec allocation. Playwright covers the full desktop/mobile flow, Back, refresh, imports, duplicate names, downloads, tool toggles, Jev failures, mocked cloud PATCH/restore, dark mode and reduced motion. Live Supabase and paid-provider execution require your credentials and are not exercised by these tests.
