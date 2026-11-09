// SQLite (libSQL / Turso) schema. Append new migrations; never edit an applied one.
// Ownership is enforced by the store functions (every query is scoped to a user id),
// because SQLite has no row-level security.
export const migrations: { id: string; sql: string }[] = [
  {
    id: "0001_core",
    sql: `
create table users (
  id text primary key,
  kind text not null check (kind in ('anonymous', 'github', 'dev')),
  github_id integer unique,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check ((kind = 'github') = (github_id is not null))
);
create table sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at text not null
);
create index sessions_user on sessions(user_id);

create table agent_builds (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  "trigger" text check ("trigger" is null or ("trigger" glob '[a-z0-9]*' and "trigger" not glob '*[^a-z0-9-]*' and "trigger" not glob '*--*' and "trigger" not glob '*-' and length("trigger") <= 64)),
  draft text not null check (json_valid(draft) and length(draft) <= 64000),
  spec text check (spec is null or json_valid(spec)),
  revision integer not null default 1,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create unique index agent_builds_user_trigger on agent_builds(user_id, "trigger") where "trigger" is not null;
create index agent_builds_recent on agent_builds(user_id, updated_at desc);

create table skill_requests (
  user_id text not null references users(id) on delete cascade,
  search_term text not null check (length(search_term) between 1 and 200 and search_term = lower(trim(search_term))),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (user_id, search_term)
);

create table profiles (
  user_id text primary key references users(id) on delete cascade,
  handle text not null unique check (length(handle) between 1 and 39 and handle not glob '*[^a-z0-9-]*' and handle not glob '-*' and handle not glob '*-'),
  display_name text not null check (length(display_name) between 1 and 80),
  avatar_url text check (avatar_url is null or (length(avatar_url) <= 300 and avatar_url like 'https://avatars.githubusercontent.com/%'))
);

create table setups (
  id text primary key,
  user_id text not null references profiles(user_id) on delete cascade,
  slug text not null check (length(slug) <= 64 and slug not glob '*[^a-z0-9-]*' and slug not glob '-*' and slug not glob '*-' and slug not glob '*--*'),
  title text not null check (length(title) between 1 and 80),
  description text not null default '' check (length(description) <= 500),
  items text not null check (json_valid(items) and json_type(items) = 'array' and json_array_length(items) between 1 and 30 and length(items) <= 64000),
  -- A plain column (not generated) so Turso's own tools can open the file; the check keeps it honest.
  item_count integer not null check (item_count = json_array_length(items)),
  published integer not null default 0 check (published in (0, 1)),
  revision integer not null default 1,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (user_id, slug)
);
create index setups_recent on setups(published, updated_at desc);

create table catalog_maintainers (
  user_id text primary key references users(id) on delete cascade
);
create table catalog_runs (
  id text primary key,
  actor text not null references users(id),
  status text not null default 'staging' check (status in ('staging', 'published', 'superseded')),
  next_page integer not null default 0,
  expected_total integer check (expected_total between 1 and 100000),
  started_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  published_at text
);
create unique index catalog_one_published on catalog_runs(status) where status = 'published';
create table catalog_entries (
  run_id text not null references catalog_runs(id) on delete cascade,
  id text not null,
  metadata text not null check (json_valid(metadata)),
  primary key (run_id, id)
);
create table catalog_overrides (
  target text primary key,
  decision text not null check (decision in ('approved-source', 'excluded', 'flagged', 'unreviewed')),
  reason text not null check (length(reason) between 1 and 2000),
  requirements text not null default '{}' check (json_valid(requirements) and json_type(requirements) = 'object'),
  revision integer not null,
  actor text not null references users(id),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create table catalog_audit (
  id integer primary key autoincrement,
  actor text not null references users(id),
  action text not null,
  target text not null,
  before_value text,
  after_value text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`,
  },
];
