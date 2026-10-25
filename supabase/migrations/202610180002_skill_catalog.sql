-- Catalog publication uses staged generations. Only an explicit, authenticated
-- maintainer can write; ordinary/anonymous builder users can read published data.
create table public.catalog_maintainers (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.catalog_maintainers enable row level security;
-- Membership is provisioned by a database operator, never by the browser.
create function public.is_catalog_maintainer() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
    and coalesce(auth.jwt()->>'is_anonymous', 'true') = 'false'
    and exists(select 1 from public.catalog_maintainers where user_id = auth.uid());
$$;
revoke all on function public.is_catalog_maintainer() from public;
grant execute on function public.is_catalog_maintainer() to anon, authenticated;

create table public.catalog_runs (
  id uuid primary key default gen_random_uuid(),
  actor uuid not null default auth.uid() references auth.users(id),
  status text not null default 'staging' check(status in ('staging','published','superseded')),
  next_page integer not null default 0,
  expected_total integer check(expected_total between 1 and 100000),
  started_at timestamptz not null default now(),
  published_at timestamptz
);
create unique index catalog_one_published on public.catalog_runs(status) where status = 'published';
create table public.catalog_entries (
  run_id uuid not null references public.catalog_runs(id) on delete cascade,
  id text not null,
  metadata jsonb not null,
  primary key(run_id, id)
);
create table public.catalog_overrides (
  target text primary key,
  decision text not null check(decision in ('approved-source','excluded','flagged','unreviewed')),
  reason text not null check(length(reason) between 1 and 2000),
  requirements jsonb not null default '{}'::jsonb check(jsonb_typeof(requirements) = 'object'),
  revision integer not null,
  actor uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create table public.catalog_audit (
  id bigint generated always as identity primary key,
  actor uuid not null references auth.users(id),
  action text not null,
  target text not null,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

alter table public.catalog_runs enable row level security;
alter table public.catalog_entries enable row level security;
alter table public.catalog_overrides enable row level security;
alter table public.catalog_audit enable row level security;
grant select on public.catalog_runs, public.catalog_entries, public.catalog_overrides to anon, authenticated;
grant select on public.catalog_audit to authenticated;
create policy "Published run or maintainer" on public.catalog_runs for select using (status = 'published' or public.is_catalog_maintainer());
create policy "Published entries or maintainer" on public.catalog_entries for select using (
  public.is_catalog_maintainer() or exists(select 1 from public.catalog_runs r where r.id = run_id and r.status = 'published')
);
create policy "Public curation evidence" on public.catalog_overrides for select using (true);
create policy "Maintainer audit access" on public.catalog_audit for select using (public.is_catalog_maintainer());

-- Definer RPCs are the only write path. Each checks an operator-managed role;
-- fixed search paths and schema-qualified tables avoid object substitution.
create function public.start_catalog_sync() returns public.catalog_runs
language plpgsql security definer set search_path = public as $$
declare result public.catalog_runs;
begin
  if not public.is_catalog_maintainer() then raise exception 'Maintainer required' using errcode = '42501'; end if;
  insert into public.catalog_runs default values returning * into result;
  insert into public.catalog_audit(actor, action, target) values(auth.uid(), 'sync-start', result.id::text);
  return result;
end;
$$;
create function public.stage_catalog_page(p_run uuid, p_page integer, p_total integer, p_more boolean, p_entries jsonb)
returns public.catalog_runs language plpgsql security definer set search_path = public as $$
declare r public.catalog_runs; n integer; item jsonb;
begin
  if not public.is_catalog_maintainer() then raise exception 'Maintainer required' using errcode = '42501'; end if;
  -- Serialize publication so older jobs cannot replace newer publications.
  perform pg_advisory_xact_lock(72140815);
  select * into r from public.catalog_runs where id = p_run for update;
  if r.id is null or r.status <> 'staging' or r.next_page <> p_page then
    raise exception 'Sync revision conflict' using errcode = '40001';
  end if;
  if p_total is null or p_more is null or p_total not between 1 and 100000
     or (r.expected_total is not null and r.expected_total <> p_total)
     or jsonb_typeof(p_entries) is distinct from 'array'
     or octet_length(p_entries::text) > 2000000 then
    raise exception 'Invalid catalog page' using errcode = '22023';
  end if;
  n := jsonb_array_length(p_entries);
  if n < 1 or n > 500 or (p_more and n <> 500) then
    raise exception 'Incomplete catalog page' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(item) is distinct from 'object' or item->>'id' is null
       or length(item->>'id') > 500 or item->>'source' is null or item->>'slug' is null
       or item->>'id' <> (item->>'source') || '/' || (item->>'slug') then
      raise exception 'Invalid catalog entry' using errcode = '22023';
    end if;
    -- Duplicate ids across pages abort the page rather than hiding missing rows.
    insert into public.catalog_entries(run_id,id,metadata) values(p_run,item->>'id',item);
  end loop;
  if (select count(*) from public.catalog_entries where run_id = p_run) <> p_page * 500 + n
     or (p_more and p_page * 500 + n >= p_total)
     or (not p_more and p_page * 500 + n <> p_total) then
    raise exception 'Catalog count mismatch' using errcode = '22023';
  end if;
  update public.catalog_runs set expected_total = p_total, next_page = next_page + 1 where id = p_run;
  if not p_more then
    if exists(select 1 from public.catalog_runs where status = 'published' and started_at >= r.started_at) then
      raise exception 'Newer catalog already published' using errcode = '40001';
    end if;
    update public.catalog_runs set status = 'superseded' where status = 'published';
    update public.catalog_runs set status = 'published', published_at = now() where id = p_run;
    insert into public.catalog_audit(actor,action,target,after_value)
      values(auth.uid(),'sync-publish',p_run::text,jsonb_build_object('total',p_total));
  end if;
  select * into r from public.catalog_runs where id = p_run;
  return r;
end;
$$;
create function public.curate_catalog(p_target text, p_decision text, p_reason text, p_requirements jsonb, p_revision integer)
returns public.catalog_overrides language plpgsql security definer set search_path = public as $$
declare previous public.catalog_overrides; result public.catalog_overrides;
begin
  if not public.is_catalog_maintainer() then raise exception 'Maintainer required' using errcode = '42501'; end if;
  if p_target is null or length(p_target) not between 3 and 500 then raise exception 'Invalid target' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_target, 1));
  select * into previous from public.catalog_overrides where target = p_target;
  if p_revision is null or coalesce(previous.revision,0) <> p_revision then raise exception 'Curation revision conflict' using errcode = '40001'; end if;
  insert into public.catalog_overrides(target,decision,reason,requirements,revision,actor)
    values(p_target,p_decision,p_reason,p_requirements,p_revision + 1,auth.uid())
    on conflict(target) do update set decision=excluded.decision,reason=excluded.reason,
      requirements=excluded.requirements,revision=excluded.revision,actor=excluded.actor,updated_at=now()
    returning * into result;
  insert into public.catalog_audit(actor,action,target,before_value,after_value)
    values(auth.uid(),'curate',p_target,to_jsonb(previous),to_jsonb(result));
  return result;
end;
$$;
revoke all on function public.start_catalog_sync() from public, anon;
revoke all on function public.stage_catalog_page(uuid,integer,integer,boolean,jsonb) from public, anon;
revoke all on function public.curate_catalog(text,text,text,jsonb,integer) from public, anon;
grant execute on function public.start_catalog_sync(), public.stage_catalog_page(uuid,integer,integer,boolean,jsonb), public.curate_catalog(text,text,text,jsonb,integer) to authenticated;
