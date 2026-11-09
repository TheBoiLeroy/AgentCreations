# Project guidance

## Creation flow

- `Agent Integration Plan New.md` is the current scope. `README.md` documents runtime setup and deployment limits.
- `packages/spec` owns versioned specs, draft validation, trigger generation and target-independent export checks (`specProblems`). New exports use v3; `parseAgentSpec()` migrates v1/v2 at import and hosted-runtime boundaries. Keep `slug` equal to `trigger` for existing adapters.
- Jev turns the form into a spec: `classifyRuntime` (worker vs extension; ask on conflict), `suggestDetails` (defaults for the details page; never chip labels as input text), `pendingQuestions` (blocks review) and `createAgentSpec`. Never write placeholder text into a spec.
- Describe-to-create (`packages/jev/src/describe.ts`) turns one typed or dictated sentence into a whole draft through the same functions, then the `proposed` reducer action lands on review, or on details when questions remain. Every default it fills goes in `draft.assumed` and is shown on review; any user edit clears that list. Keyword-only external skills are suggested but left off. Never take an email address or other identity from the model.
- Add a page by extending `steps`/`BuildDraft`, then the single reducer in `apps/web/lib/build-machine.ts`, its guarded transitions and restore behavior. Give the page its own component in `components/build-pages.tsx` and wire progress/Back in `app/page.tsx`. Test refresh and backward navigation with every new answer field.
- `use-build.ts` owns local recovery and serialized saves. Preserve revision conflicts: stale writes must fail rather than overwrite.

## Storage and sign-in

- Storage is libSQL (Turso): a local file at `.data/agent-creations.db` by default, Turso Cloud when `TURSO_DATABASE_URL` is set. `apps/web/lib/server/store/db.ts` opens it once per process and applies `store/migrations.ts`. Add a new migration to the end; never edit one that has been applied. Keep the schema readable by Turso's own `tursodb` CLI (no stored generated columns).
- SQLite has no row-level security. Every read and write goes through a store function that takes the owner's user id and puts it in the `where` clause; route handlers never write SQL. Test ownership, conflicts and visibility in `store/store.test.ts` against a real in-memory database.
- Sessions are random tokens in an HttpOnly cookie; only their SHA-256 is stored. Visitors get an anonymous account on their first save. GitHub sign-in (`/auth/sign-in`, `/auth/callback`) upgrades that account in place, and the profile handle comes from the GitHub login, never from a form. The access token is used once and not stored.
- `/auth/dev-sign-in` exists for local work without an OAuth app. It must stay limited to `NODE_ENV=development` on a loopback host; never widen it.
- `corepack pnpm db migrate | where | maintainer <handle>` manages the local database.

## Icons and motion

- Keep icon source files only in root `agent-icons`; import SVGs through the SVGR mapping in `components/agent-icon.tsx`. Preserve the embedded frame classes/keyframes. Do not copy assets to `public` or redraw them.
- Category tiles use `motion="gif"`: a still first SVG frame, swapped for the matching `agent-icons/gif` loop while hovered/focused/selected. This user-initiated GIF plays even under reduced motion by request; ambient animation must still honor it. GIFs keep the original palette.
- Use the wrapper's `accent` and `paused` props to recolor/pause. Honor reduced motion in both CSS frame animations and Framer Motion. Page exit + entry total about 360 ms; Back reverses the direction.
- Style through semantic CSS variables so new pages work in both system and manually selected dark mode.

## Jev and tools

- Add tools in `packages/jev/src/catalog.ts`: stable id, human label, description, whole-word/phrase keywords, connection requirement and authoritative `requiresApproval`. Add chips/defaults where relevant and tests for false-positive partial words.
- Rules always run. Explicit chip recommendations survive model merging. Optional model output is catalog-id-only, validated and bounded to eight seconds; errors/timeouts fall back to rules. Keep model keys and calls inside `POST /api/jev` (a `{ description }` body asks for a whole draft).
- Approval flags come from the catalog, never the LLM or recommendation reasons. One fixed exception in `createAgentSpec`: `send-email` needs no approval when the user confirmed the recipient is themself, and it can then only reach the per-user recipient setting. Selecting a tool describes a requirement; it does not provision an integration or grant runtime permissions.

## Existing adapters and safety

- Keep exporters pure: spec in, files out. Generated Pi packages must run without npm or unpublished workspace dependencies (local installs don't install dependencies).
- Pi runtime code lives in `packages/pi-runner/templates/*.ts`, typechecked against the real Pi API. Run `corepack pnpm templates` after editing them; a test fails if `src/templates.ts` is stale.
- Every spec tool id must resolve through `packages/exporters/src/registry.ts`; worker flags and bundled tools come only from there. Unknown ids stop the Pi export. instructions.md lists only granted tools.
- The Pi worker is read-only, not an OS sandbox. Preserve cancellation, output bounds, timeouts and shutdown cleanup. The extension template must clear timers, widget, status and heartbeat files on `session_shutdown`.
- Builder fields, drafts and exports are not secret storage. Keep credentials in server environment variables. Report local-only storage, cloud failures, OAuth requirements and unpublished packages honestly.
- Before declaring changes verified, run `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm test:e2e`, and `corepack pnpm build`. Browser cloud tests mock transport; PGlite tests execute RLS/uniqueness SQL. Report live Supabase/provider verification separately.

## Requirements and export checks

- A request is first turned into typed requirements (`packages/jev/src/requirements.ts`: rules, plus an optional validated model list). A "stated" requirement must quote the request; anything else is "assumed". The user confirms the list on the review page before an agent can be created.
- `createAgentSpec` maps every requirement to a place in the spec and records it in `coveredBy`. `requirementProblems` (part of `specProblems`) re-checks each one against the spec itself, so an uncovered or contradicted requirement stops the export. Never drop one quietly: add the generation and the check together when adding a requirement type.
- Descriptions are composed by `describeAgent` as "<What it does>. Use when <situations>." Never interpolate the request or a draft field into that sentence.
- Personal answers (question type `email`) become `settings` each person fills in. Their values stay in the draft and must never reach a spec or an exported file; `scrub` removes addresses typed into the description.
- `checkExport` (`packages/exporters/src/check.ts`) runs inside every exporter on the generated files: duplicate headings, frontmatter, description shape, configured inputs called optional, email addresses, requirement coverage. Extend it when a template bug is found, with a fixture in `packages/jev/src/fixtures.test.ts`.
- `POST /api/jev` with `{ verify: spec }` is the model completeness check. It returns one verdict per requirement id or `unavailable`; it never reports a pass it did not make.

## Profiles and setups

- Setups can start from the user's agents (`setupFromAgents`), or be imported (`parseSetupImport`): links, commands, GitHub skill folders, agent or setup JSON, frontmatter, and bare names. Bare names are resolved by `POST /api/setups/resolve` from the curated catalog, published setups and the synced index only; nothing is sent to another service.
- `/u/<handle>/<slug>/install.sh` is the one-command install (`setupInstallScript`). Only validated tokens reach the script unquoted; titles are single-quoted and agent files go through a quoted here-document whose delimiter can't appear in the file. Keep the sh-execution tests in `setup-install.test.ts` passing when changing it, and never pipe it to `sh` in docs: the skills CLI may need the terminal.

- A setup is a published package: skills referenced by `owner/repository` + skill name, and agent specs built here. Its contract, the pasted-reference parser and the install script live in `packages/spec/src/setups.ts` (`@agents/spec/setups`). The site never stores or serves third-party skill code.
- Repository and skill tokens end up in copyable shell commands. Keep their patterns free of spaces and shell metacharacters, and validate stored items again in the browser before rendering or exporting them.
- Profiles exist only for GitHub accounts. `claim_profile()` takes the handle from `auth.identities`, never from request input or `user_metadata`. There is no direct write path to `profiles`.
- Public pages read through the session-less client and ask for `published` rows only. Writes go through `account()` in `apps/web/lib/server/setups.ts`, which rejects anonymous builder sessions. Updates must name the revision they read.
- Agents in a setup are full specs, including instructions and configured answers. Keep the warning in the editor that publishing makes them public.
