# Propose-and-correct implementation status

Source: [Agent Builder: Propose-and-Correct Spec](Agent%20Builder%20Propose-and-Correct%20Spec.md).

## Current scope: milestone 1, partial

The new primitives live in `packages/spec/src/propose`, available through
`@agents/spec/propose`. They are not connected to the website, database, existing
exporters or hosted runtime yet. This is not a second working builder or a new
export format. The existing builder and v1/v2/v3 import/export behavior remain
unchanged. Do not begin milestones 2–7 until the remaining core work is complete.

Implemented:

- TypeScript contracts from the spec: drafts, intents, questions, assumptions,
  templates, test runs, compiled specs, shapes and pipelines. These types alone
  do **not** validate a draft arriving over the network.
- A bounded, validated condition interpreter with all seven operators, deep JSON
  equality, own-property-only path traversal and no JavaScript evaluation.
  Malformed branches fail even when boolean short-circuiting would skip them.
- Strict runtime output-template validation: all six output kinds, stable and
  unique identifiers/names, size limits, choice lists, formula references and
  cycles, sort/group/total/chart references, section bounds and required roles.
- `templateToJsonSchema`: draft 2020-12 output contracts, required fields,
  closed objects, section/list/table mappings, and exclusion of renderer-owned
  formula columns. Data templates require a versioned shape resolver.
- Pure `applyEdit` and transactional `applyEdits`: every declared edit operation,
  sheet/column/section editing, table-section content changes, and panel columns.
  Invalid changes leave the source template untouched. Reverse edits can restore
  prior values/order. Recording inverse edits in the draft is still future work.
- Tests for all operators, template kinds and edit operations, schema snapshots,
  invalid targets, atomic failure, reversed edits, protected roles and limits.

## Interface conventions and SPEC-GAP decisions

The following gaps are marked with `SPEC-GAP` in code:

1. **Description phrase matching** (`conditions.ts`): case-insensitive whole
   words/phrases, including flexible whitespace. This avoids false positives such
   as `rate` inside `corporate`, matching existing Jev conventions.
2. **Data shape resolution** (`templates.ts`): the optional second argument to
   `templateToJsonSchema` resolves an exact shape id/version from a caller-owned
   trusted registry. Unresolved shapes fail closed; no unconstrained fallback.
3. **Edit payloads** (`edits.ts`): `add` receives a complete node and appends it;
   its id must match the target. `move` receives a zero-based destination index.
   Setters receive a replacement value; `null` clears optional settings.
   `set-total` receives the complete totals array. Column `set-type` can receive
   `{type, choices?, currency?}` to change to choice atomically. Section
   `set-type` accepts a content-kind string or `{contains: 'table', columns}`.
   Insertion is `add` followed by `move`. The future model prompt must use these
   same conventions.

Condition paths are rooted at the supplied draft (`working.inputs[0].kind`).
`exists` means neither undefined nor null; false, zero and empty strings exist.
`includes` uses deep equality for array members and literal substring matching
for strings. Empty `all` is true; empty `any` is false.

Action-plan roles are protected automatically. Other seed-specific roles must be
provided through `requiredRoles`. A future UI must obtain explicit confirmation
before changing an action plan to a document and releasing a protected role; the
core never silently downgrades the kind or deletes dependent chart/formula settings.

## Compatibility decisions still needed

- The existing public `agent.json` v3 and the proposed `AgentSpecV3` have different
  categories, input/output shapes, tools and prompt fields. Do not replace
  `parseAgentSpec` or relabel old files silently. Decide the discriminated migration
  and adapter boundary before connecting the compiler. Existing adapters also
  require `slug === trigger`, while the proposed contract has no `trigger`.
- The proposed question-selection algorithm refers to `QuestionTemplate.targets`,
  but the declared interface has none. Typed answers and inverse effects also need
  storage fields not specified in the contract.
- The seven-question hard cap conflicts with the instruction to keep asking
  non-defaultable blocking questions beyond that cap.
- The spec requires a deterministic first-lock UUID but supplies no allocation
  rule. Identity must be allocated and persisted before pure compilation.
- Test-run hashes need a canonical execution payload independent of publication
  bookkeeping (`tested`, version, draft revision), or testing changes the hash.
- The existing registry grants calculation via `analyze-data`, while the new spec
  uses `calc`. Web fetch is not currently an executable capability. Do not claim
  either new capability is wired until registry and runtime implementations agree.
- Some privacy rules prohibit storing real data in drafts while `TestRun` includes
  inline input/output data. Resolve metadata/reference storage and deletion
  boundaries before adding persistence.

## Remaining milestone-one work

- Runtime draft/spec/shape validation and the migration boundary above.
- Owner-scoped draft storage, revision conflicts, recovery and actual SQL tests.
- Registry reconciliation, deterministic compiler and all ten publication checks.
- The original three failed-export fixtures and compiler byte-identity snapshots.

After that: Describe/Questions, Preview UI, reference test runner, publishing and
renderers, connections, and hardening, in the source document's order. The owner
still needs to choose provider/model, test-run billing and caps, locale/currency,
and confirm Reddit access before its executor is implemented.

## Verification boundary

Checks run for this slice:

- `corepack pnpm typecheck`: passed.
- `corepack pnpm test`: 272 tests passed, including 86 new core tests.
- `corepack pnpm test:e2e`: 18 tests passed.
- `corepack pnpm build`: initially failed with a webpack runtime error during
  prerendering while an existing dev server shared `.next`.
- `NEXT_DIST_DIR=.next-propose-build corepack pnpm build`: passed with isolated
  artifacts. The temporary build output and its generated TypeScript config
  references were removed afterward; the existing dev server was not stopped.

The new tests exercise pure core primitives only. Existing browser tests continue
to test the old builder, not the proposed flow. No live Supabase migration,
provider request, external action, deployment or new Pi package installation has
been performed for this change.
