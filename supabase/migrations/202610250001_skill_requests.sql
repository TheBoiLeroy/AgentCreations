-- One vote per normalized search term and authenticated creator.
create table public.skill_requests (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  search_term text not null check (length(search_term) between 1 and 200 and search_term = lower(btrim(search_term))),
  created_at timestamptz not null default now(),
  primary key (user_id, search_term)
);
alter table public.skill_requests enable row level security;
grant select, insert on public.skill_requests to authenticated;
create policy skill_requests_read_own on public.skill_requests for select to authenticated using (user_id = auth.uid());
create policy skill_requests_insert_own on public.skill_requests for insert to authenticated with check (user_id = auth.uid());
-- Maintainers can aggregate counts with their administrative database connection.
-- Do not expose a cross-owner view through the public API.
