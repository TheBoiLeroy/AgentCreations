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

Confirmed against the installed Pi 1.1.0 documentation: packages declare `pi.extensions` and `pi.skills` paths in `package.json`; the generated adapter uses `extensions/agent.ts` and `skills/<slug>/SKILL.md`. Local installs work without npm publication.

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

- [x] **Agent spec + `SKILL.md` export:** validated schema, JSON Schema endpoint, portable skill ZIPs and browser builder using all five icon categories.
- [x] **Pi package adapter:** standalone package export with a read-only background worker, cancellation, limits and lifecycle tests. Live model execution still requires the user's configured Pi credentials.
- [ ] **Hosted MCP endpoint:** authenticated, self-hosted text-only endpoint implemented and protocol-tested. OAuth, app connections and production deployment remain outstanding.
- [ ] **More adapters:** Claude Code and Codex skill installs plus Cursor MCP configuration implemented. Claude app / ChatGPT OAuth compatibility remains outstanding.

Implementation notes and commands are in `README.md`. The current library uses browser-local storage; Supabase authentication/sync, npm publication automation and cloud provisioning are not implemented. The original folder contained only this plan and icon assets, with no cloud configuration.

## Decisions to make early

Three choices shape cost and safety, and they should be settled before building the hosted route.

| Decision | Option A | Option B |
| --- | --- | --- |
| Default runtime | Local: free to run, private | Hosted: easy updates and app connections, but you pay for AI usage |
| Who pays for AI calls | CLI exports use the user's own model and key | Hosted agents bill users, or users bring their own key |
| Secrets | Never in a skill file | App connections go through the hosted route or the user's own setup |

## Sources

- [Pi Coding Agent: The Strength Is in What They Didn't Build](https://pasqualepillitteri.it/en/news/5649/pi-coding-agent-what-they-didnt-build)
- [Pi Coding Agent Setup Guide](https://www.bitdoze.com/pi-coding-agent-setup-guide/)
- [pi.dev packages: pi extensions](https://pi.dev/packages/pi-extensions?page=3)
