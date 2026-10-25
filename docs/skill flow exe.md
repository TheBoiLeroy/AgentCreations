# Agent Builder: Skills Step & Post-Skills Flow

Oct 25, 2026 · @ian

## Why only 16 skills show

The cap is almost certainly in code, not a real limit on available skills. One of these is the likely cause:

- **A hard limit on the query**: `.limit(16)` or `LIMIT 16` on the skills fetch, or a default page size of 16 from the API or Supabase call.
- **A slice in the UI**: `skills.slice(0, 16)`, often left over from sizing a 4×4 grid.
- **Only 16 skills exist so far**: just a starter set was seeded into the database.

* [x] Search the codebase for `16`, `limit` and `slice` near the skills component

**Finding:** `ToolsPage` in `apps/web/components/build-pages.tsx` reads the
checked-in `packages/jev/src/catalog.ts`, which currently contains 18 entries.
There was no query limit or UI slice. The separate synchronized skills.sh index
is not wired into this builder (see `skill-catalog.md`).

## Making the skills step better

Show the right skills first, and let users find any other skill in seconds.

- **Search bar at the top**: matches names and descriptions, so "email" finds `send-email` and `gmail-draft`.
- **"Suggested for this agent" row first**: Jev already knows the job ("research and email me"), so it pre-selects `web-search` and `send-email`. Most users just click Next.
- **"Browse all" by category**: Research, Communication, Files, Data, Dev, with load-more and no cap.

## Fixing the cliff after skills

Let the selected skills decide what comes next. Each skill declares what it needs, and the next step asks only for that, in plain words.

| Skill picked | Question it adds |
| --- | --- |
| `web-search` | "What topics should it research?" |
| `send-email` | "Which email should it send to?" / Connect Gmail |
| Scheduled job | "How often?" (default: weekdays 7 AM) |

- **Pick the runtime from the skills.** Schedule plus email means a worker. Only a skill like "watch Pi sessions" ever leads to the live-extension and panel screen.
- **Treat Jev's suggestions as already accepted.** Users can edit them but don't have to approve them.
- **Collapse technical settings under Advanced**: runtime choice, watch paths, panel vs. status line, refresh rate.

Result: a research-email agent goes from skills to two questions (topics and email), then a test send.

## Implementation progress

First increment:

- [x] Search the curated catalog by name, description and stable ID, ignoring case and surrounding whitespace.
- [x] Keep suggested skills first and selected by default; searching/filtering does not change selections.
- [x] Add Research, Communication, Files, Data and Dev category filters.
- [x] Add incremental load-more with no total display cap; reset pagination when filters change.
- [x] Explain that the builder shows a curated catalog, not the full skills.sh directory.
- [x] Add desktop/mobile coverage for search, empty results, categories, reaching all entries and selection preservation through Back.

Remaining work:

- [ ] Connect the synchronized catalog only after catalog identities, selection validation and exporter support are designed together. Arbitrary external IDs currently cannot become spec tools.
- [ ] Add catalog-owned question requirements and persisted answers for topics, recipients and schedules; carry them into validated specs and exports. Cover Back and restore for each new field.
- [ ] Make runtime inference reflect selected capabilities while retaining explicit conflict questions; put technical settings under Advanced.
- [ ] Replace generic details with only the questions required by the selected skills.
- [ ] Implement authenticated mailbox connection and an explicitly approved test-send path. The current app cannot connect Gmail, schedule execution or send email; selection must not imply those capabilities exist.

## Second increment: skill metadata and guided research/email flow

Implemented:

- Every curated entry exposes the typed skill-record fields in `packages/spec/src/skills.ts`, including provenance, permissions, runtime support and test status. Existing entries are conservatively model-dependent workers and are not marked runtime-tested.
- `research a topic and email me` recommends web search and sending, without adding mailbox-reading merely because of the word email.
- Research/email combinations (plus drafting/planning/review behaviors) use deduplicated topics/recipient questions. Other combinations retain the existing details flow; input metadata for those skills still needs expansion.
- Answers survive Back and snapshot restore, are validated before review, and round-trip in an optional v3 `skillAnswers` field. Configured values are also included as data in exported instructions. Older drafts default to empty answers.
- Model-dependent selections choose workers before considering live wording. Explicit incompatible extension overrides block review/spec creation. Imported specs still undergo existing defensive exporter checks.
- Selected permissions are shown before review. Runtime override and live watch/display controls are collapsed under Advanced controls.
- Catalog browsing is grouped by category. Empty searches show missing-skill options; only Request it is operational.
- `POST /api/skill-requests` logs one vote per normalized term and authenticated browser owner. Apply `supabase/migrations/202610250001_skill_requests.sql`; RLS ownership and vote uniqueness are tested with PGlite. No live migration was applied.

Still unimplemented (not represented as working):

- Private custom-skill generation/storage, actual SKILL.md/MCP parsing and import, shared-skill review/publication controls, and migration of the separate synchronized catalog into the new skill-record contract.
- Skill-driven questions for all other combinations, scheduling/timezone defaults and actual scheduled execution.
- Configurable refresh intervals and moving the install/export target into Advanced.
- An authenticated research/email execution provider, account ownership verification, approved real test sends, and server-owned tested-status transitions. The test-send control is disabled with an explanation; no successful run is simulated.

The existing defaults already accept Jev’s suggested skills without an approval step. Runtime permissions have not been expanded: Pi workers remain read-only and cannot research online or send email. The requested description → two questions → real test send → done flow is therefore **not complete**.
