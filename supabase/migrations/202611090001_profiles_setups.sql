-- Public profiles and published setups. Requires the GitHub provider in Supabase Auth.
-- A profile exists only for an account with a GitHub identity, so anonymous builder
-- sessions can read published setups but can never publish one.
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9]([a-z0-9-]{0,37}[a-z0-9])?$'),
  display_name text not null check (length(display_name) between 1 and 80),
  avatar_url text check (avatar_url is null or (length(avatar_url) <= 300 and avatar_url ~ '^https://avatars\.githubusercontent\.com/')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
grant select on public.profiles to anon, authenticated;
create policy "Profiles are public" on public.profiles for select using (true);

-- The only write path. The handle comes from the provider's identity record, which
-- the user cannot edit, never from request input or user_metadata.
create function public.claim_profile() returns public.profiles
language plpgsql security definer set search_path = public as $$
declare d jsonb; result public.profiles; new_handle text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select identity_data into d from auth.identities
    where user_id = auth.uid() and provider = 'github' order by created_at limit 1;
  new_handle := lower(d->>'user_name');
  if new_handle is null or new_handle !~ '^[a-z0-9]([a-z0-9-]{0,37}[a-z0-9])?$' then
    raise exception 'GitHub sign-in required' using errcode = '42501';
  end if;
  insert into public.profiles(user_id, handle, display_name, avatar_url)
  values(
    auth.uid(), new_handle,
    left(coalesce(nullif(btrim(d->>'full_name'), ''), nullif(btrim(d->>'name'), ''), new_handle), 80),
    case when length(d->>'avatar_url') <= 300 and d->>'avatar_url' ~ '^https://avatars\.githubusercontent\.com/' then d->>'avatar_url' end
  )
  on conflict(user_id) do update set handle = excluded.handle, display_name = excluded.display_name, avatar_url = excluded.avatar_url
  returning * into result;
  return result;
end;
$$;
revoke all on function public.claim_profile() from public, anon;
grant execute on function public.claim_profile() to authenticated;

create table public.setups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(user_id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
  title text not null check (length(title) between 1 and 80),
  description text not null default '' check (length(description) <= 500),
  items jsonb not null check (
    case when jsonb_typeof(items) = 'array' then jsonb_array_length(items) between 1 and 30 else false end
    and octet_length(items::text) <= 64000
  ),
  item_count integer generated always as (case when jsonb_typeof(items) = 'array' then jsonb_array_length(items) else 0 end) stored,
  published boolean not null default false,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);
create index setups_recent on public.setups(updated_at desc) where published;
alter table public.setups enable row level security;
grant select on public.setups to anon, authenticated;
grant insert, delete on public.setups to authenticated;
grant update(slug, title, description, items, published, revision, updated_at) on public.setups to authenticated;
create policy "Published setups or own" on public.setups for select using (published or user_id = auth.uid());
create policy "Owners insert setups" on public.setups for insert to authenticated with check (user_id = auth.uid());
create policy "Owners update setups" on public.setups for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Owners delete setups" on public.setups for delete to authenticated using (user_id = auth.uid());

-- Stale writes fail: an update must name the revision it read and advance it by one.
create function public.setups_revision() returns trigger language plpgsql as $$
begin
  if new.revision <> old.revision + 1 then
    raise exception 'Setup changed elsewhere; reload before saving' using errcode = '40001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger setups_revision before update on public.setups for each row execute function public.setups_revision();
