-- Enable anonymous sign-ins in Supabase Auth before using the builder.
create table public.agent_builds (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  trigger text check (trigger ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(trigger) <= 64),
  draft jsonb not null,
  spec jsonb,
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
create unique index agent_builds_user_trigger on public.agent_builds(user_id, trigger) where trigger is not null;
alter table public.agent_builds enable row level security;
grant select, insert, update on public.agent_builds to authenticated;
create policy "Owners read their builds" on public.agent_builds for select to authenticated using (user_id = auth.uid());
create policy "Owners insert their builds" on public.agent_builds for insert to authenticated with check (user_id = auth.uid());
create policy "Owners update their builds" on public.agent_builds for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Serialize allocations per owner and reject stale writes from another tab/device.
-- SECURITY INVOKER deliberately preserves RLS; no service-role key is needed.
create function public.save_agent_build(p_id uuid, p_draft jsonb, p_base text, p_expected_revision integer, p_spec jsonb default null)
returns public.agent_builds language plpgsql security invoker set search_path = public as $$
declare
  existing public.agent_builds;
  saved public.agent_builds;
  candidate text := p_base;
  suffix integer := 2;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if octet_length(p_draft::text) > 64000 or (p_base is not null and (p_base !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_base) > 64)) then
    raise exception 'Invalid build' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  select * into existing from public.agent_builds where id = p_id and user_id = auth.uid() for update;
  if (existing.id is null and p_expected_revision <> 0) or (existing.id is not null and existing.revision <> p_expected_revision) then
    raise exception 'Draft changed elsewhere; reload before saving' using errcode = '40001';
  end if;
  -- Keep an existing allocation when the name has not changed.
  if existing.id is not null and existing.draft->>'name' = p_draft->>'name' then candidate := existing.trigger;
  elsif p_base is not null then
    while exists(select 1 from public.agent_builds where user_id = auth.uid() and trigger = candidate and id <> p_id) loop
      candidate := rtrim(left(p_base, 64 - length('-' || suffix::text)), '-') || '-' || suffix::text;
      suffix := suffix + 1;
    end loop;
  end if;
  if p_spec is not null then
    if candidate is null then raise exception 'Name required' using errcode = '22023'; end if;
    p_spec := p_spec || jsonb_build_object('trigger', candidate, 'slug', candidate);
  end if;
  insert into public.agent_builds(id, user_id, trigger, draft, spec, revision)
  values(p_id, auth.uid(), candidate, p_draft, p_spec, 1)
  on conflict(id) do update set trigger = excluded.trigger, draft = excluded.draft, spec = excluded.spec,
    revision = agent_builds.revision + 1, updated_at = now()
    where agent_builds.user_id = auth.uid()
  returning * into saved;
  if saved.id is null then raise exception 'Build unavailable' using errcode = '42501'; end if;
  return saved;
end;
$$;
revoke all on function public.save_agent_build(uuid,jsonb,text,integer,jsonb) from public, anon;
grant execute on function public.save_agent_build(uuid,jsonb,text,integer,jsonb) to authenticated;
