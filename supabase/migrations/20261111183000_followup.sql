-- Etap 3 (follow-up): powroty klienta do sesji, powiadomienia dla konsultanta (outbox → n8n),
-- przywracanie stanu z rozmowy.
--
-- Zasady jak dotąd: RLS na każdej tabeli, jawne granty, RPC tylko dla service_role, widoczność dziedziczona
-- z calc_sessions. Dziennik zmian `calc_events` (niezmienny) pozostaje dowodem tego, co klient zmienił;
-- `session_visits` to tabela OPERACYJNA (serwer przedłuża `last_activity_at`), nie dowód.

-- ---------------------------------------------------------------------------
-- Profil konsultanta: adresat powiadomień (Telegram chat id). Oba pola albo żadne.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column notify_channel text check (notify_channel in ('telegram')),
  add column notify_target text check (notify_target ~ '^-?[0-9]{5,20}$'),
  add constraint profiles_notify_pair check ((notify_channel is null) = (notify_target is null));

grant update (notify_channel, notify_target) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- session_visits: „wizyta” klienta po zamrożeniu stanu. Nowa wizyta zaczyna się po 30 min ciszy.
-- ---------------------------------------------------------------------------
create table public.session_visits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  session_id uuid not null,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  changed boolean not null default false,
  foreign key (session_id, org_id) references public.calc_sessions (id, org_id) on delete restrict
);
create index session_visits_session_id_idx on public.session_visits (session_id, started_at);
create index session_visits_org_id_idx on public.session_visits (org_id);

-- ---------------------------------------------------------------------------
-- notification_outbox: powiadomienia do wysłania (n8n). Klient nie ma tu żadnego dostępu — tylko serwer.
-- Wpis ≠ wysłanie: awaria odbiornika zostawia go do ponowienia (do 5 prób).
-- ---------------------------------------------------------------------------
create table public.notification_outbox (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  session_id uuid not null,
  consultant_id uuid not null references auth.users (id) on delete restrict,
  visit_id uuid not null references public.session_visits (id) on delete restrict,
  kind text not null check (kind in ('client_returned', 'client_changed')),
  -- zmiana danych rozpoczęła wizytę (klient nie otwierał strony na nowo) — alert brzmi „wrócił i zmienił”
  new_visit boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0,
  claimed_until timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (visit_id, kind),
  foreign key (session_id, org_id) references public.calc_sessions (id, org_id) on delete restrict
);
create index notification_outbox_pending_idx on public.notification_outbox (status, created_at) where status = 'pending';
create index notification_outbox_session_id_idx on public.notification_outbox (session_id);
create index notification_outbox_org_id_idx on public.notification_outbox (org_id);
create index notification_outbox_consultant_id_idx on public.notification_outbox (consultant_id);
create index notification_outbox_visit_id_idx on public.notification_outbox (visit_id);

-- ---------------------------------------------------------------------------
-- Rejestrowanie aktywności klienta po zamrożeniu stanu
-- ---------------------------------------------------------------------------
-- Okno wizyty: 30 minut od ostatniej aktywności. Przed zamrożeniem rozmowa jest „na żywo” i nie jest powrotem.
-- Wołane z RPC record_guest_visit (otwarcie strony) i z triggera zmian danych klienta. Blokada wiersza sesji
-- serializuje równoległe wywołania (np. dwie karty), a unikalność (visit_id, kind) jest drugą siatką bezpieczeństwa.
create function private.register_guest_activity(p_session_id uuid, p_changed boolean, p_touch boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.calc_sessions;
  v public.session_visits;
begin
  select * into s from public.calc_sessions where id = p_session_id and status <> 'archived' for update;
  if not found then
    return;
  end if;
  if not exists (select 1 from public.calc_snapshots c where c.session_id = s.id) then
    return;
  end if;

  select * into v from public.session_visits where session_id = s.id order by started_at desc limit 1;

  if not found or v.last_activity_at < now() - interval '30 minutes' then
    insert into public.session_visits (org_id, session_id, changed)
    values (s.org_id, s.id, p_changed)
    returning * into v;
    -- Wizyta rozpoczęta zmianą danych ma jeden alert „zmienił dane”; rozpoczęta otwarciem strony — „wrócił”.
    insert into public.notification_outbox (org_id, session_id, consultant_id, visit_id, kind, new_visit)
    values (s.org_id, s.id, s.consultant_id, v.id, case when p_changed then 'client_changed' else 'client_returned' end, p_changed)
    on conflict (visit_id, kind) do nothing;
    if p_touch then
      perform private.touch_session(s.id);
    end if;
    return;
  end if;

  update public.session_visits set last_activity_at = now() where id = v.id;
  if p_changed and not v.changed then
    update public.session_visits set changed = true where id = v.id;
    insert into public.notification_outbox (org_id, session_id, consultant_id, visit_id, kind)
    values (s.org_id, s.id, s.consultant_id, v.id, 'client_changed')
    on conflict (visit_id, kind) do nothing;
  end if;
end $$;

-- Zmiana danych albo miksu BEZ zalogowanego użytkownika = klient (ten sam rozpoznawalnik aktora co w dzienniku zmian).
create function private.guest_change_registers_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    perform private.register_guest_activity(new.id, true, false);
  end if;
  return null;
end $$;

create trigger calc_sessions_guest_activity
  after update on public.calc_sessions
  for each row
  when (old.inputs is distinct from new.inputs or old.mix_kh is distinct from new.mix_kh)
  execute function private.guest_change_registers_activity();

-- Otwarcie strony przez klienta (Edge Function guest-session, akcja get z `visit`).
create function public.record_guest_visit(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select id into v_id from public.calc_sessions where token = p_token and status <> 'archived';
  if v_id is null then
    return false;
  end if;
  perform private.register_guest_activity(v_id, false, true);
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Przywrócenie stanu z rozmowy (żywe dane sesji wracają do snapshotu). Dziennik zapisze zmiany jako aktora guest.
-- ---------------------------------------------------------------------------
create function public.restore_session_to_snapshot(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  s public.calc_sessions;
  snap public.calc_snapshots;
  v_mix integer;
begin
  select * into s from public.calc_sessions where token = p_token and status <> 'archived' for update;
  if not found then
    raise exception 'Sesja nie istnieje' using errcode = 'AT001';
  end if;
  select * into snap from public.calc_snapshots c where c.session_id = s.id;
  if not found then
    raise exception 'Sesja nie ma zamrożonego stanu' using errcode = 'AT002';
  end if;

  v_mix := case when (snap.mix ->> 'kh') ~ '^[0-9]{1,9}$' then (snap.mix ->> 'kh')::integer end;
  update public.calc_sessions
  set inputs = private.filter_inputs(snap.inputs), mix_kh = v_mix
  where id = s.id;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Odbiór powiadomień przez serwer: atomowe „przejęcie” (bez podwójnej wysyłki) i zamknięcie wpisu
-- ---------------------------------------------------------------------------
-- Zwraca tablicę JSON z danymi do alertu: bez firmy, e-maila i wartości (decyzja produktowa: minimum + link).
create function public.claim_notifications(p_session_id uuid default null, p_limit integer default 20)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  with picked as (
    select o.id
    from public.notification_outbox o
    where o.status = 'pending'
      and o.attempts < 5
      and (o.claimed_until is null or o.claimed_until < now())
      and (p_session_id is null or o.session_id = p_session_id)
    order by o.created_at, o.id
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  ),
  claimed as (
    update public.notification_outbox o
    set attempts = o.attempts + 1, claimed_until = now() + interval '60 seconds'
    from picked
    where o.id = picked.id
    returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'kind', c.kind,
    'new_visit', c.new_visit,
    'created_at', c.created_at,
    'session_id', c.session_id,
    'organization', org.name,
    'consultant_name', prof.full_name,
    'notify_channel', prof.notify_channel,
    'notify_target', prof.notify_target,
    'changed_fields', case when c.kind = 'client_changed' then (
      select count(distinct e.field)::int from public.calc_events e
      join public.session_visits v on v.id = c.visit_id
      where e.session_id = c.session_id and e.actor = 'guest' and e.created_at >= v.started_at
        and e.field not in ('company_id')
    ) end
  ) order by c.id), '[]'::jsonb)
  into v_result
  from claimed c
  join public.organizations org on org.id = c.org_id
  left join public.profiles prof on prof.user_id = c.consultant_id;

  return v_result;
end $$;

-- outcome: sent (dostarczono), skipped (konsultant nie ma adresata), retry (awaria; po 5 próbach → failed).
create function public.finish_notification(p_id bigint, p_outcome text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_outcome not in ('sent', 'skipped', 'retry') then
    raise exception 'Nieznany wynik: %', p_outcome using errcode = '22023';
  end if;
  update public.notification_outbox o
  set status = case
        when p_outcome = 'sent' then 'sent'
        when p_outcome = 'skipped' then 'skipped'
        when o.attempts >= 5 then 'failed'
        else 'pending' end,
      sent_at = case when p_outcome = 'sent' then now() else o.sent_at end,
      claimed_until = null
  where o.id = p_id and o.status = 'pending';
end $$;

-- ---------------------------------------------------------------------------
-- Granty i RLS
-- ---------------------------------------------------------------------------
revoke execute on function public.record_guest_visit(text) from public, anon, authenticated;
grant execute on function public.record_guest_visit(text) to service_role;
revoke execute on function public.restore_session_to_snapshot(text) from public, anon, authenticated;
grant execute on function public.restore_session_to_snapshot(text) to service_role;
revoke execute on function public.claim_notifications(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(uuid, integer) to service_role;
revoke execute on function public.finish_notification(bigint, text) from public, anon, authenticated;
grant execute on function public.finish_notification(bigint, text) to service_role;

-- Konsultant czyta wizyty swoich sesji (admin organizacji — całej organizacji); outbox jest tylko dla serwera.
grant select on public.session_visits to authenticated;
alter table public.session_visits enable row level security;
alter table public.notification_outbox enable row level security;

create policy session_visits_select on public.session_visits for select to authenticated
  using (session_id in (select s.id from public.calc_sessions s));

revoke execute on all functions in schema private from public, anon;
