# Maintained skill catalog: rollout and operations

## Agreed delivery order

1. Catalog storage, synchronization, and protected curation.
2. Searchable discovery and an optional destination choice before Jev recommendations.
3. Dynamic Jev recommendations and saved-agent update notices.

The current implementation is the **stage-one backend foundation**, not the complete rollout. Jev still uses the bundled six external skills and existing built-in capabilities. Successfully synchronizing the discovery index does not approve or activate any new recommendation.

## Implemented

- `202610180002_skill_catalog.sql`: staged catalog generations, atomic publication, operator-managed maintainer membership, curation overlays, expected-revision conflicts, and append-only audit events.
- A bounded skills.sh adapter using the documented `/api/v1/skills` all-time listing. Fetches at most one 500-entry page per request, with a 15-second source deadline, a 2 MB streamed-byte limit, fixed source URL, redirect rejection, identity/link validation, and pagination checks.
- `GET /api/catalog`: honest bundled-mode status and published-index freshness/coverage when available.
- `GET /api/catalog/manage`: maintainer-only recent sync progress.
- `POST /api/catalog/manage`: maintainer-only start, advance, and curation commands.
- SQL-engine tests for authorization, staging visibility, partial failures, duplicate pages, atomic publication, stale writes, preserved overrides, and audit history.

Each advance request stages one validated page. Only the final page of a complete generation publishes it. The preceding generation remains visible on source errors, timeouts, inconsistent totals, duplicate entries, malformed metadata, or incomplete syncs. Concurrent advances use database revision checks. Older jobs cannot overwrite a newer published generation.

**Coverage:** skills.sh documents a 100,000-row serving window for the unfiltered global listing. This is a discovery index, not an exhaustive inventory of open-source skills. A disappearing listing entry is not evidence that its upstream repository was removed. Old generations are retained; no removal classification is inferred here.

## Setup prerequisites

No infrastructure is provisioned by this change.

1. Configure the existing server-only `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
2. Apply `supabase/migrations/202610180002_skill_catalog.sql` through your migration process. Keep RLS enabled.
3. Have a database operator add an existing **non-anonymous** Supabase account's UUID to `public.catalog_maintainers`. The application cannot grant itself this membership. Do not add anonymous builder accounts.
4. Enable Vercel OIDC for the deployed Vercel project. The adapter reads `VERCEL_OIDC_TOKEN` fresh on each request, following the documented raw-token production integration. Never expose it through `NEXT_PUBLIC_`, pass it from browser input, or commit it. Local tokens expire and need refreshing; automatic local token refresh is not implemented.
5. Authenticate management calls with the maintainer's Supabase session cookies or short-lived Supabase user access token in `Authorization: Bearer …`. There is no shared administrator password or service-role key. The database independently enforces membership and non-anonymous identity.

There is not yet a maintainer sign-in page or management UI. Account provisioning and authentication use your existing Supabase account tooling. Missing source authentication returns 503 for sync operations; curation remains available if database authentication is configured.

## Management request bodies

Send JSON to `POST /api/catalog/manage`.

Start a staged generation:

```json
{ "action": "start" }
```

The response contains `run.id`. Advance it one page at a time:

```json
{ "action": "advance", "runId": "the-returned-uuid" }
```

Continue until the returned run has `status: "published"`. Respect HTTP 429 `Retry-After`; use bounded exponential backoff for transient 503 errors. After a lost response or 409, reload run progress before continuing. Do not blindly restart on every error. A changing upstream total or duplicate caused by ranking movement prevents publication; a fresh complete run is required if the current snapshot can no longer be completed consistently.

Record a curation decision:

```json
{
  "action": "curate",
  "change": {
    "target": "anthropics/skills/pdf",
    "decision": "flagged",
    "reason": "Pending review of changed dependencies",
    "requirements": { "fileRead": true, "fileWrite": true, "verified": false },
    "revision": 0
  }
}
```

A new target uses revision zero. Updates must supply the current revision; stale writes return 409. Decisions are `approved-source`, `excluded`, `flagged`, or `unreviewed`. Source targets use repository identities; skill targets use complete skill identities. Requirements can record `fileRead`, `fileWrite`, `shell`, `browser`, `network`, `credentials`, and `verified`. Omitted requirements mean unknown, not false. Curation reasons are public evidence: do not include credentials or private information.

The sync never writes curation records. Only the curation RPC writes them, recording actor, reason, timestamp, and before/after values. There are no browser grants for editing membership or deleting audit history.

## Remaining before stage one is complete

- An authenticated maintainer UI, including account sign-in, curation inspection, audit inspection, and compatibility corrections.
- A daily scheduler/worker with durable retries, run monitoring, and a defined machine identity. The APIs are resumable building blocks; **nothing currently runs on a daily schedule**.
- Prioritized detail, content-hash, and upstream audit ingestion. Current sync is listing metadata only.
- Staged/superseded generation retention and cleanup policy. Current implementation retains all generations; avoid unattended repeated runs until retention is implemented.
- Live Supabase migration, authentication, and Vercel/skills.sh API verification. Tests use mocked transport and PGlite; they do not prove live service access.

## Requirements for later stages

- Search local synchronized metadata; never send user drafts or prompts to the directory.
- Explain automated checks, historical upstream audits, manual review, and unknown compatibility separately. No blanket safe badge.
- Rank by task fit, compatibility, source confidence, and maintenance; popularity is supporting evidence only.
- No automatic recommendation of unreviewed entries. Maintainer exclusions must also apply to offline fallback entries.
- Record selected source, immutable upstream revision when available, content hash, requirements, and the evidence snapshot the user reviewed. A hash is not an installable Git commit.
- Mark legacy selections as version not recorded. Do not retroactively claim current upstream content was selected previously.
- Changed content invalidates approval of that new version. Users explicitly adopt updates, preserving the earlier agent snapshot, then re-export/reinstall.
- Do not expand the read-only Pi worker or text-only hosted runtime's permissions. External installation, dependencies, and supported host setup remain explicit user actions.

## Source

[skills.sh API documentation](https://skills.sh/docs/api) documents Vercel OIDC authentication, 600 requests/minute per team/project, pagination, a global serving window, content-hash/detail endpoints, and partner audit endpoints. The integration uses the documented fixed API, not HTML scraping or private endpoints.
