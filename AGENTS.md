# Project guidance

## Creation flow

- `Agent Integration Plan New.md` is the current scope. `README.md` documents runtime setup and deployment limits.
- `packages/spec` owns versioned specs, draft validation, trigger generation and target-independent export checks (`specProblems`). New exports use v3; `parseAgentSpec()` migrates v1/v2 at import and hosted-runtime boundaries. Keep `slug` equal to `trigger` for existing adapters.
- Jev turns the form into a spec: `classifyRuntime` (worker vs extension; ask on conflict), `suggestDetails` (defaults for the details page; never chip labels as input text), `pendingQuestions` (blocks review) and `createAgentSpec`. Never write placeholder text into a spec.
- Add a page by extending `steps`/`BuildDraft`, then the single reducer in `apps/web/lib/build-machine.ts`, its guarded transitions and restore behavior. Give the page its own component in `components/build-pages.tsx` and wire progress/Back in `app/page.tsx`. Test refresh and backward navigation with every new answer field.
- `use-build.ts` owns local recovery and serialized cloud saves. Preserve revision conflicts: stale writes must fail rather than overwrite. Cloud rows are owner-scoped through Supabase RLS and an invoker RPC. Apply schema changes through `supabase/migrations` and test the actual SQL in PGlite.

## Icons and motion

- Keep icon source files only in root `agent-icons`; import SVGs through the SVGR mapping in `components/agent-icon.tsx`. Preserve the embedded frame classes/keyframes. Do not copy assets to `public` or redraw them.
- Category tiles use `motion="gif"`: a still first SVG frame, swapped for the matching `agent-icons/gif` loop while hovered/focused/selected. This user-initiated GIF plays even under reduced motion by request; ambient animation must still honor it. GIFs keep the original palette.
- Use the wrapper's `accent` and `paused` props to recolor/pause. Honor reduced motion in both CSS frame animations and Framer Motion. Page exit + entry total about 360 ms; Back reverses the direction.
- Style through semantic CSS variables so new pages work in both system and manually selected dark mode.

## Jev and tools

- Add tools in `packages/jev/src/catalog.ts`: stable id, human label, description, whole-word/phrase keywords, connection requirement and authoritative `requiresApproval`. Add chips/defaults where relevant and tests for false-positive partial words.
- Rules always run. Explicit chip recommendations survive model merging. Optional model output is catalog-id-only, validated and bounded to eight seconds; errors/timeouts fall back to rules. Keep model keys and calls inside `POST /api/jev`.
- Approval flags come from the catalog, never the LLM or recommendation reasons. Selecting a tool describes a requirement; it does not provision an integration or grant runtime permissions.

## Existing adapters and safety

- Keep exporters pure: spec in, files out. Generated Pi packages must run without npm or unpublished workspace dependencies (local installs don't install dependencies).
- Pi runtime code lives in `packages/pi-runner/templates/*.ts`, typechecked against the real Pi API. Run `corepack pnpm templates` after editing them; a test fails if `src/templates.ts` is stale.
- Every spec tool id must resolve through `packages/exporters/src/registry.ts`; worker flags and bundled tools come only from there. Unknown ids stop the Pi export. instructions.md lists only granted tools.
- The Pi worker is read-only, not an OS sandbox. Preserve cancellation, output bounds, timeouts and shutdown cleanup. The extension template must clear timers, widget, status and heartbeat files on `session_shutdown`.
- Builder fields, drafts and exports are not secret storage. Keep credentials in server environment variables. Report local-only storage, cloud failures, OAuth requirements and unpublished packages honestly.
- Before declaring changes verified, run `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm test:e2e`, and `corepack pnpm build`. Browser cloud tests mock transport; PGlite tests execute RLS/uniqueness SQL. Report live Supabase/provider verification separately.
