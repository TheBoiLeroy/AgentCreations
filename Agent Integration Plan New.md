# Agent Integration Plan

Oct 18, 2026 · @ian

## Core idea: build once, export through adapters

The site saves every agent in one neutral format, the agent spec, and a small adapter per tool turns it into what that tool understands. The user picks their tool and gets a one-line install command.

&#91;embedded content: agent spec to adapters to tools · 3 routes\]

The agent spec holds, mostly from the existing builder flow:

- Name, short trigger name (`lead-sorter`) and one-line description
- Category and type
- Instructions: the "starts with… gives back…" sentence, expanded into a full prompt
- What it needs: files, web access, app connections
- Boundaries: what it must ask before doing
- Output format and where the output goes

## Three ways an agent plugs in

One spec can reach coding CLIs locally, or reach any chat app through a hosted endpoint.

| Route | How it works | Best for |
| --- | --- | --- |
| 1. Skill file | Export the agent as a `SKILL.md` folder; pi, Claude Code and other tools read this format | Coding CLIs; cheapest to build, fully local |
| 2. Native plugin | A small per-tool package adds a `/lead-sorter` command and runs the agent as a separate worker | Pi users who want to invoke it and let it work |
| 3. Hosted agent over MCP | The agent runs on your server; any MCP-capable app connects with a URL | Claude, ChatGPT, Cursor and other non-CLI apps; agents that need app logins |

## What it looks like in pi

In pi, you type `/lead-sorter check this week's form submissions` and the agent works in the background, then reports back. Pi leaves MCP and subagents out on purpose and expects them to come from extensions and packages, so a pi package from the site carries:

- **A skill** with the agent's instructions, which pi loads only when it's relevant.
- **An extension** that registers the `/lead-sorter` slash command. The command starts a separate pi run with the agent's instructions and hands it the task, so the main session stays free.
- **One-line install:** `pi install npm:@yoursite/lead-sorter`, or straight from a git repo the site generates for the user.

Open question: confirm in pi's docs or repo which folders pi reads skills and extensions from before writing the adapter.

## User flow on the site

After building an agent, the user is one copy-paste away from using it in their own tool.

1. The user finishes building the agent.
2. A screen asks **"Where do you want to use it?"** with chips: Pi, Claude Code, Codex, Claude app, ChatGPT, Cursor, Other / just download.
3. The site shows the matching install snippet with a copy button, plus a "Test it" example prompt.
4. Updates: hosted agents change instantly when the user edits them; package installs pick up changes on their next update.

## Recommended tech stack

Use TypeScript end to end in one monorepo: pi extensions, the MCP SDK and the website all speak it, and AI coding tools know this stack best.

| Layer | Pick | Why it suits AI-assisted building |
| --- | --- | --- |
| Language | TypeScript (strict mode) | One language for site, adapters and server; types catch AI mistakes early |
| Repo | pnpm workspaces monorepo | Site, spec, exporters and MCP server share code and types |
| Website | Next.js + Tailwind + shadcn/ui | The most common web stack in AI training data; fast to scaffold |
| Database, auth, storage | Supabase (Postgres) | Accounts, saved agents and generated files in one service; already connected here |
| Agent spec | Zod schema, exported as JSON Schema | One source of truth that validates the builder, the exporters and the API |
| Exporters | Plain TS functions: spec in, files out | Each adapter (skill, pi package, MCP config) is small, testable and easy for an AI to add |
| Hosted agents | Official MCP TypeScript SDK over HTTP | The standard way chat apps connect to remote tools |
| AI calls | Anthropic SDK or Vercel AI SDK, user-supplied key | Lets hosted agents run on any model without you paying by default |
| Hosting | Vercel for the site; Docker for the MCP server (cloud or your own server) | Push-to-deploy for the site; the server runs anywhere |
| Packages | npm org scope + GitHub Actions publishing | Makes `pi install npm:@yoursite/<agent>` work automatically |
| Tests | Vitest for exporters, Playwright for the builder flow | Gives an AI a fast check that its changes didn't break exports |

Suggested layout:

```
apps/web            Next.js builder site
apps/mcp-server     hosted agents over MCP
packages/spec       Zod agent spec + JSON Schema
packages/exporters  skill, pi package, MCP config generators
packages/pi-runner  pi extension: /command + background worker
AGENTS.md           project rules any AI coding tool reads first
```

A root `AGENTS.md` (and a `CLAUDE.md` pointing to it) tells any coding AI the stack, the folder rules and how to run tests, so it can start building straight away.

## Build order

Start with the agent spec and the skill export, since that pair already works in pi and Claude Code.

- [ ] **Agent spec + `SKILL.md` export:** the smallest piece, already usable in pi and Claude Code.
- [ ] **Pi package adapter:** testable on yourself; adds the `/command` that starts a background worker.
- [ ] **Hosted MCP endpoint:** opens up chat apps and safely holds agents that need logins (Gmail, TrackMyLeads data).
- [ ] **More adapters:** added one at a time, based on which tools users pick in the flow.

## Decisions to make early

Three choices shape cost and safety, and they should be settled before building the hosted route.

| Decision | Option A | Option B |
| --- | --- | --- |
| Default runtime | Local: free to run, private | Hosted: easy updates and app connections, but you pay for AI usage |
| Who pays for AI calls | CLI exports use the user's own model and key | Hosted agents bill users, or users bring their own key |
| Secrets | Never in a skill file | App connections go through the hosted route or the user's own setup |

## Next changes: agent creation flow

The plan above is treated as built. This round rebuilds the creation flow from the paper sketch: animated category picks, three follow-up pages, and Jev choosing the agent's tools.

### New flow

1. **Page 1: category.** Five animated category icons: Information & Analysis, Creation & Communication, Action & Automation, Support & Oversight, Planning & Reasoning. A pick saves the category to the agent build (backend) and shows "Added to agent build".
2. **Page 2: name your agent.** The trigger name is always generated from the name (`Quote Writer` becomes `/quote-writer`). Users never type it. A taken trigger gets `-2`, `-3` and so on.
3. **Page 3: what will the agent need?** The "starts with … gives back …" chips plus a free-text box.
4. **Jev step (transition).** Jev reads page 3 and picks the tools while an animated "Jev is reading…" screen shows the words it noticed.
5. **Page 4: advised skills.** Jev's picks, each with a reason, switched on by default. Users can switch them off or add more from the catalog.
6. **Review and create.** A summary plus the saved agent spec, then the existing "Where do you want to use it?" step.

Every page change is a direction-aware slide and fade, about 360 ms; Back reverses it. The chosen icon flies into the header and stays there as the agent's avatar. Reduced-motion settings turn all of this off.

### What to build

- [x] **Animation files:** use the existing animated icons in the `agent-icons` folder instead of redrawing them. Import them as React components (SVGR) so they can be recolored and paused, and keep `agent-icons` as the only copy.
- [x] **Step machine:** one component per page, driven by a single reducer, with page transitions done through Framer Motion `AnimatePresence`.
- [x] **Agent build backend:** an `agent_builds` table in Supabase and `PATCH /api/agent-builds/:id` after every page, so a half-finished agent is never lost.
- [x] **Trigger rule:** `triggerFromName()` and `uniqueTrigger()` in `packages/spec`, enforced by a unique (user, trigger) index.
- [x] **Jev package:** `packages/jev` holds the tool catalog, a rules pass (chips and keywords, instant), and an optional LLM pass that can only pick catalog ids. It falls back to rules if the LLM pass fails or takes longer than 8 seconds.
- [x] **Jev API:** `POST /api/jev`, server only, so the API key never reaches the browser.
- [x] **Agent spec update:** add `trigger`, `needs` and `tools[].requiresApproval`. Tools that send or change things are marked "Asks before sending or changing".
- [x] **Implementation guide:** a root `AGENTS.md` that tells any coding AI how to add pages, icons and catalog tools cleanly.

### Jev in short

| Pass | Input | Output | When it runs |
| --- | --- | --- | --- |
| Rules | Chip ids + keywords in the free text | Tools with a reason and a confidence score | Always |
| LLM | Same input, catalog ids only | Tools for free text the rules missed, plus a follow-up question | Only if there's an API key and at least 12 characters of text |

Tools from chips the user picked always stay. If nothing matches, Jev falls back to the category's default tools and asks what the agent should connect to.

### Done when

- [x] A user can go from category to created agent without a page reload, and Back keeps every answer.
- [x] Refreshing the page mid-flow restores the draft.
- [x] Jev tests pass (chips, keywords, fallback, no partial-word matches) and trigger tests pass.
- [x] The flow works at phone width, in dark mode, and with reduced motion.

Implementation note: the Supabase migration and API are implemented and SQL-tested with PGlite, but have not been deployed to a live Supabase project. Configure the server variables and apply the migration as described in `README.md`. Without configuration, draft recovery is device-local and explicitly labeled. Jev's optional live model pass also requires server credentials; deterministic rules work without them. Spec v1 imports migrate to v2 while existing export formats remain available.

## Sources

- [Pi Coding Agent: The Strength Is in What They Didn't Build](https://pasqualepillitteri.it/en/news/5649/pi-coding-agent-what-they-didnt-build)
- [Pi Coding Agent Setup Guide](https://www.bitdoze.com/pi-coding-agent-setup-guide/)
- [pi.dev packages: pi extensions](https://pi.dev/packages/pi-extensions?page=3)
