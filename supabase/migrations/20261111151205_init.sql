-- Etap 1: model wieloklientowy (multi-tenant) kalkulatora.
-- Tabele: organizations, profiles, memberships, platform_operators,
--         calc_sessions, calc_snapshots, calc_events, usage_events.
-- Zasady: RLS na każdej tabeli, jawne granty (nic domyślnie), tylko-dopisywanie dla
-- calc_snapshots / calc_events / usage_events, brak dostępu operatora do danych sesji.

-- ---------------------------------------------------------------------------
-- Uprawnienia domyślne: nic nie jest dostępne, dopóki nie nadamy tego jawnie.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tabele
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  nip text check (nip ~ '^[0-9]{10}$'),
  brand jsonb not null default '{}'::jsonb,          -- logo, kolory, nadawca maili
  privacy_policy_url text,
  default_params jsonb not null default '{}'::jsonb, -- ciche założenia; puste = wartości wbudowane (src/calc)
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  photo_url text,
  phone text,
  signature text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'consultant')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id);

-- Rola operatora to uprawnienie konta, nie cecha organizacji. Zarządzane migracjami / service role.
create table public.platform_operators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.calc_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  consultant_id uuid not null references auth.users (id) on delete restrict,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  status text not null default 'live' check (status in ('live', 'shared', 'archived')),
  inputs jsonb not null default '{}'::jsonb,  -- dane rozmówcy (kształt UI: kh, kpir, prac, przychod, koszty, ef, wspCzas, wspCena)
  params jsonb not null default '{}'::jsonb,  -- ciche założenia sesji (kopia z organizacji w chwili utworzenia)
  revealed boolean not null default false,
  mix_kh integer check (mix_kh is null or mix_kh >= 0),
  reply text not null default '' check (length(reply) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);
create index calc_sessions_org_id_idx on public.calc_sessions (org_id);
create index calc_sessions_consultant_id_idx on public.calc_sessions (consultant_id);

-- Zamrożony stan: tylko INSERT (egzekwowane granty, brakiem polityk i triggerem).
create table public.calc_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  session_id uuid not null,
  inputs jsonb not null,
  params jsonb not null,
  result jsonb not null,
  mix jsonb not null,
  calc_version text not null,
  created_at timestamptz not null default now(),
  foreign key (session_id, org_id) references public.calc_sessions (id, org_id) on delete restrict
);
create index calc_snapshots_session_id_idx on public.calc_snapshots (session_id);
create index calc_snapshots_org_id_idx on public.calc_snapshots (org_id);

create table public.calc_events (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  session_id uuid not null,
  actor text not null check (actor in ('guest', 'consultant')),
  actor_id uuid,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now(),
  foreign key (session_id, org_id) references public.calc_sessions (id, org_id) on delete restrict
);
create index calc_events_session_id_idx on public.calc_events (session_id, created_at);
create index calc_events_org_id_idx on public.calc_events (org_id);

create table public.usage_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete restrict,
  session_id uuid references public.calc_sessions (id) on delete restrict,
  consultant_id uuid references auth.users (id) on delete set null,
  event_type text not null check (event_type in ('session_created')),
  created_at timestamptz not null default now()
);
create index usage_events_org_created_idx on public.usage_events (org_id, created_at);

-- ---------------------------------------------------------------------------
-- Funkcje pomocnicze RLS (schemat private, security definer, pusty search_path)
-- ---------------------------------------------------------------------------
create function private.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid())
  );
$$;

create function private.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  );
$$;

create function private.is_org_owner(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

create function private.is_operator() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_operators o where o.user_id = (select auth.uid())
  );
$$;

-- Profil innej osoby widzi właściciel / admin organizacji, do której ta osoba należy.
create function private.can_see_profile(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships target
    join public.memberships me on me.org_id = target.org_id
    where target.user_id = p_user
      and me.user_id = (select auth.uid())
      and me.role in ('owner', 'admin')
  );
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_org_member(uuid), private.is_org_admin(uuid), private.is_org_owner(uuid),
  private.is_operator(), private.can_see_profile(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Triggery
-- ---------------------------------------------------------------------------
-- Nowy użytkownik Auth => pusty profil.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Nazwę i NIP organizacji zmienia tylko operator (marka i założenia także właściciel).
create function private.guard_organization_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not private.is_operator()
     and (new.name is distinct from old.name or new.nip is distinct from old.nip) then
    raise exception 'Nazwę i NIP organizacji może zmienić tylko operator' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger organizations_guard_update
  before update on public.organizations
  for each row execute function private.guard_organization_update();

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger calc_sessions_set_updated_at
  before update on public.calc_sessions
  for each row execute function private.set_updated_at();

-- Tylko-dopisywanie: UPDATE, DELETE i TRUNCATE rzucają wyjątek (także dla service role).
create function private.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Tabela % jest tylko do dopisywania (% zablokowane)', tg_table_name, tg_op
    using errcode = '42501';
end $$;

create trigger calc_snapshots_append_only
  before update or delete on public.calc_snapshots
  for each row execute function private.forbid_mutation();
create trigger calc_snapshots_no_truncate
  before truncate on public.calc_snapshots
  for each statement execute function private.forbid_mutation();

create trigger calc_events_append_only
  before update or delete on public.calc_events
  for each row execute function private.forbid_mutation();
create trigger calc_events_no_truncate
  before truncate on public.calc_events
  for each statement execute function private.forbid_mutation();

create trigger usage_events_append_only
  before update or delete on public.usage_events
  for each row execute function private.forbid_mutation();
create trigger usage_events_no_truncate
  before truncate on public.usage_events
  for each statement execute function private.forbid_mutation();

-- Każda utworzona sesja = jedno zdarzenie użycia.
create function private.record_session_usage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.usage_events (org_id, session_id, consultant_id, event_type)
  values (new.org_id, new.id, new.consultant_id, 'session_created');
  return null;
end $$;

create trigger calc_sessions_record_usage
  after insert on public.calc_sessions
  for each row execute function private.record_session_usage();

-- Dziennik zmian: kto (rozmówca bez JWT / konsultant), które pole, z jakiej wartości na jaką.
create function private.log_session_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_actor text := case when v_uid is null then 'guest' else 'consultant' end;
  k text;
begin
  for k in select jsonb_object_keys(old.inputs) union select jsonb_object_keys(new.inputs) loop
    if old.inputs -> k is distinct from new.inputs -> k then
      insert into public.calc_events (org_id, session_id, actor, actor_id, field, old_value, new_value)
      values (new.org_id, new.id, v_actor, v_uid, k, old.inputs -> k, new.inputs -> k);
    end if;
  end loop;

  for k in select jsonb_object_keys(old.params) union select jsonb_object_keys(new.params) loop
    if old.params -> k is distinct from new.params -> k then
      insert into public.calc_events (org_id, session_id, actor, actor_id, field, old_value, new_value)
      values (new.org_id, new.id, v_actor, v_uid, 'params.' || k, old.params -> k, new.params -> k);
    end if;
  end loop;

  if old.mix_kh is distinct from new.mix_kh then
    insert into public.calc_events (org_id, session_id, actor, actor_id, field, old_value, new_value)
    values (new.org_id, new.id, v_actor, v_uid, 'mix_kh', to_jsonb(old.mix_kh), to_jsonb(new.mix_kh));
  end if;
  if old.revealed is distinct from new.revealed then
    insert into public.calc_events (org_id, session_id, actor, actor_id, field, old_value, new_value)
    values (new.org_id, new.id, v_actor, v_uid, 'revealed', to_jsonb(old.revealed), to_jsonb(new.revealed));
  end if;
  if old.reply is distinct from new.reply then
    insert into public.calc_events (org_id, session_id, actor, actor_id, field, old_value, new_value)
    values (new.org_id, new.id, v_actor, v_uid, 'reply', to_jsonb(old.reply), to_jsonb(new.reply));
  end if;
  return null;
end $$;

create trigger calc_sessions_log_changes
  after update on public.calc_sessions
  for each row execute function private.log_session_changes();

-- Ping Realtime dla rozmówcy (bez danych w payloadzie): kanał session:<token>.
create function private.notify_session_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send('{}'::jsonb, 'changed', 'session:' || new.token, false);
  return null;
end $$;

create trigger calc_sessions_notify
  after update on public.calc_sessions
  for each row execute function private.notify_session_changed();

-- Konsultant dostaje zmiany wiersza przez postgres_changes (przechodzą przez RLS).
alter publication supabase_realtime add table public.calc_sessions;

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------
-- Dozwolone klucze danych rozmówcy; wartość: liczba albo pusty tekst.
create function private.filter_inputs(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
  from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) e
  where e.key in ('kh', 'kpir', 'prac', 'przychod', 'koszty', 'ef', 'wspCzas', 'wspCena')
    and (jsonb_typeof(e.value) = 'number' or e.value = '""'::jsonb);
$$;
revoke execute on function private.filter_inputs(jsonb) from public, anon, authenticated;
grant execute on function private.filter_inputs(jsonb) to authenticated, service_role;

create function public.create_calc_session(p_org_id uuid) returns public.calc_sessions
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.calc_sessions;
begin
  if (select auth.uid()) is null or not private.is_org_member(p_org_id) then
    raise exception 'Brak dostępu do organizacji' using errcode = '42501';
  end if;

  insert into public.calc_sessions (org_id, consultant_id, params)
  select o.id, (select auth.uid()), o.default_params
  from public.organizations o
  where o.id = p_org_id
  returning * into v_session;

  return v_session;
end $$;

-- Konsultant dopisuje dane do swojej sesji (merge, bez nadpisywania pól wpisanych równolegle przez rozmówcę).
create function public.patch_calc_session_inputs(p_session_id uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Wymagane logowanie' using errcode = '42501';
  end if;

  update public.calc_sessions s
  set inputs = s.inputs || private.filter_inputs(p_patch)
  where s.id = p_session_id
    and s.consultant_id = (select auth.uid())
    and s.status <> 'archived';

  if not found then
    raise exception 'Brak dostępu do sesji' using errcode = '42501';
  end if;
end $$;

-- Rozmówca (Edge Function z service role): dane, miks i odpowiedź — nic więcej.
create function public.guest_patch_calc_session(
  p_token text, p_patch jsonb, p_mix_kh integer default null, p_reply text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.calc_sessions s
  set inputs = s.inputs || private.filter_inputs(p_patch),
      mix_kh = coalesce(p_mix_kh, s.mix_kh),
      reply = coalesce(left(p_reply, 2000), s.reply)
  where s.token = p_token and s.status <> 'archived';
  return found;
end $$;

revoke execute on function public.create_calc_session(uuid) from public, anon;
grant execute on function public.create_calc_session(uuid) to authenticated;
revoke execute on function public.patch_calc_session_inputs(uuid, jsonb) from public, anon;
grant execute on function public.patch_calc_session_inputs(uuid, jsonb) to authenticated;
revoke execute on function public.guest_patch_calc_session(text, jsonb, integer, text)
  from public, anon, authenticated;
grant execute on function public.guest_patch_calc_session(text, jsonb, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- Granty (kolumnowe tam, gdzie klient nie może zmieniać wszystkiego)
-- ---------------------------------------------------------------------------
grant select, insert, delete on public.organizations to authenticated;
grant update (name, nip, brand, privacy_policy_url, default_params) on public.organizations to authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, photo_url, phone, signature) on public.profiles to authenticated;

grant select, insert, delete on public.memberships to authenticated;
grant update (role) on public.memberships to authenticated;

grant select on public.platform_operators to authenticated;

-- inputs i reply zmieniają się wyłącznie przez RPC powyżej.
grant select on public.calc_sessions to authenticated;
grant update (params, revealed, mix_kh, status) on public.calc_sessions to authenticated;

grant select, insert on public.calc_snapshots to authenticated;
grant select on public.calc_events to authenticated;
grant select on public.usage_events to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.platform_operators enable row level security;
alter table public.calc_sessions enable row level security;
alter table public.calc_snapshots enable row level security;
alter table public.calc_events enable row level security;
alter table public.usage_events enable row level security;

-- organizations: członkowie widzą swoją, operator widzi wszystkie.
create policy organizations_select on public.organizations for select to authenticated
  using (private.is_org_member(id) or private.is_operator());
create policy organizations_insert on public.organizations for insert to authenticated
  with check (private.is_operator());
create policy organizations_update on public.organizations for update to authenticated
  using (private.is_operator() or private.is_org_owner(id))
  with check (private.is_operator() or private.is_org_owner(id));
create policy organizations_delete on public.organizations for delete to authenticated
  using (private.is_operator());

-- profiles: własny edytuje tylko właściciel; cudzy widzi admin organizacji.
create policy profiles_select on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or private.can_see_profile(user_id));
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- memberships: zarządzają właściciel organizacji i operator.
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or private.is_org_admin(org_id) or private.is_operator());
create policy memberships_insert on public.memberships for insert to authenticated
  with check (private.is_org_owner(org_id) or private.is_operator());
create policy memberships_update on public.memberships for update to authenticated
  using (private.is_org_owner(org_id) or private.is_operator())
  with check (private.is_org_owner(org_id) or private.is_operator());
create policy memberships_delete on public.memberships for delete to authenticated
  using (private.is_org_owner(org_id) or private.is_operator());

-- platform_operators: każdy widzi tylko własny wiersz (zapis tylko migracje / service role).
create policy platform_operators_select on public.platform_operators for select to authenticated
  using (user_id = (select auth.uid()));

-- calc_sessions: konsultant swoje, właściciel/admin całą organizację. Operator: nic.
-- Brak polityki INSERT: sesje powstają przez create_calc_session().
create policy calc_sessions_select on public.calc_sessions for select to authenticated
  using (consultant_id = (select auth.uid()) or private.is_org_admin(org_id));
create policy calc_sessions_update on public.calc_sessions for update to authenticated
  using (consultant_id = (select auth.uid()))
  with check (consultant_id = (select auth.uid()));

-- calc_snapshots / calc_events: widoczność dziedziczona z calc_sessions (jej RLS działa w podzapytaniu).
-- Brak polityk UPDATE/DELETE; calc_events nie ma też INSERT (wpisuje trigger).
create policy calc_snapshots_select on public.calc_snapshots for select to authenticated
  using (session_id in (select s.id from public.calc_sessions s));
create policy calc_snapshots_insert on public.calc_snapshots for insert to authenticated
  with check (session_id in (select s.id from public.calc_sessions s));

create policy calc_events_select on public.calc_events for select to authenticated
  using (session_id in (select s.id from public.calc_sessions s));

-- usage_events: właściciel/admin organizacji i operator (rozliczenia). Zapis tylko trigger.
create policy usage_events_select on public.usage_events for select to authenticated
  using (private.is_org_admin(org_id) or private.is_operator());

-- Funkcje tworzone po pierwszym revoke też nie mają być wykonywalne publicznie.
revoke execute on all functions in schema private from public, anon;
