-- Etap 2 (Lead): firmy z GUS, leady, dostawy kalkulacji i zamrożenie stanu przez serwer.
--
-- Zasady (jak w etapie 1): RLS na każdej tabeli, jawne granty, tylko-dopisywanie dla leadów i dostaw,
-- a zapisy klienta wyłącznie przez Edge Functions (service role) i RPC. Rozmówca nie ma żadnego
-- dostępu do tabel. Tabela `consents` powstanie dopiero z landing page'em (etap 4).
--
-- Kody błędów RPC (SQLSTATE): AT001 sesja nie istnieje, AT002 dane zablokowane (NIP lub e-mail),
-- AT003 przekroczony limit, AT004 stan sesji zmienił się w trakcie (powtórz), AT005 sesja niegotowa.

-- ---------------------------------------------------------------------------
-- companies: firmy rozmówców (NIP + dane z GUS). Pisze tylko serwer.
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete restrict,
  nip text not null check (nip ~ '^[0-9]{10}$'),
  regon text check (length(regon) <= 20),
  name text check (length(name) <= 500),               -- null, gdy GUS był niedostępny
  street text check (length(street) <= 200),
  building_no text check (length(building_no) <= 50),
  unit_no text check (length(unit_no) <= 50),
  postal_code text check (length(postal_code) <= 20),
  city text check (length(city) <= 200),
  voivodeship text check (length(voivodeship) <= 100),
  gus_type text check (gus_type in ('P', 'F', 'LP', 'LF')), -- osoba prawna / fizyczna / jednostki lokalne
  gus_status text not null default 'found' check (gus_status in ('found', 'unavailable')),
  gus_raw jsonb,                                       -- surowa odpowiedź GUS; nigdy nie trafia do rozmówcy
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (org_id, nip),
  unique (id, org_id)
);
create index companies_org_id_idx on public.companies (org_id);

alter table public.calc_sessions add column company_id uuid;
alter table public.calc_sessions
  add constraint calc_sessions_company_fkey
  foreign key (company_id, org_id) references public.companies (id, org_id) on delete restrict;
create index calc_sessions_company_id_idx on public.calc_sessions (company_id) where company_id is not null;

-- ---------------------------------------------------------------------------
-- calc_snapshots: jedno zamrożenie na sesję, tworzone wyłącznie przez serwer.
-- ---------------------------------------------------------------------------
alter table public.calc_snapshots add constraint calc_snapshots_session_id_key unique (session_id);
alter table public.calc_snapshots add constraint calc_snapshots_id_session_key unique (id, session_id);
drop index public.calc_snapshots_session_id_idx; -- zastąpiony przez unikalność powyżej

-- Zamrożony stan zasila leada i mail, więc klient nie może go sam „utworzyć” (np. z dowolnym wynikiem).
drop policy calc_snapshots_insert on public.calc_snapshots;
revoke insert on public.calc_snapshots from authenticated;

-- ---------------------------------------------------------------------------
-- leads: e-mail podany w CTA. Tylko dopisywanie; wiele wierszy na sesję dopuszczone
-- (poprawka literówki, zanim cokolwiek wysłano).
-- ---------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  session_id uuid not null,
  consultant_id uuid not null references auth.users (id) on delete restrict,
  company_id uuid not null,
  snapshot_id uuid not null,
  email text not null check (email = lower(email) and length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  created_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (session_id, org_id) references public.calc_sessions (id, org_id) on delete restrict,
  foreign key (company_id, org_id) references public.companies (id, org_id) on delete restrict,
  foreign key (snapshot_id, session_id) references public.calc_snapshots (id, session_id) on delete restrict
);
create index leads_session_id_idx on public.leads (session_id, created_at);
create index leads_org_id_idx on public.leads (org_id);
create index leads_company_id_idx on public.leads (company_id);
create index leads_snapshot_id_idx on public.leads (snapshot_id);
create index leads_consultant_id_idx on public.leads (consultant_id);

-- ---------------------------------------------------------------------------
-- lead_deliveries: próby wysłania kalkulacji. Tylko dopisywanie; licznik wysyłek = liczba wierszy `sent`.
-- ---------------------------------------------------------------------------
create table public.lead_deliveries (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  lead_id uuid not null,
  status text not null check (status in ('sent', 'failed')),
  provider text not null check (provider in ('mailersend', 'mailpit')),
  provider_message_id text check (length(provider_message_id) <= 200),
  error text check (length(error) <= 500),             -- krótki, bezpieczny opis; bez sekretów
  created_at timestamptz not null default now(),
  foreign key (lead_id, org_id) references public.leads (id, org_id) on delete restrict
);
create index lead_deliveries_lead_id_idx on public.lead_deliveries (lead_id);
create index lead_deliveries_org_id_idx on public.lead_deliveries (org_id);

-- Użycie do rozliczeń: sesje i wysłane kalkulacje.
alter table public.usage_events drop constraint usage_events_event_type_check;
alter table public.usage_events
  add constraint usage_events_event_type_check check (event_type in ('session_created', 'calculation_sent'));

-- ---------------------------------------------------------------------------
-- Triggery
-- ---------------------------------------------------------------------------
-- Dane firmy z GUS są zablokowane, gdy istnieje lead, który się na nie powołuje.
create function private.guard_company_locked() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.leads l where l.company_id = old.id) then
    raise exception 'Dane firmy są zablokowane po utworzeniu leada' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

create trigger companies_guard_locked
  before update or delete on public.companies
  for each row execute function private.guard_company_locked();

create trigger leads_append_only
  before update or delete on public.leads
  for each row execute function private.forbid_mutation();
create trigger leads_no_truncate
  before truncate on public.leads
  for each statement execute function private.forbid_mutation();

create trigger lead_deliveries_append_only
  before update or delete on public.lead_deliveries
  for each row execute function private.forbid_mutation();
create trigger lead_deliveries_no_truncate
  before truncate on public.lead_deliveries
  for each statement execute function private.forbid_mutation();

-- Udana dostawa = zdarzenie użycia + sesja przechodzi do „udostępniona”.
create function private.record_delivery_effects() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads;
begin
  if new.status <> 'sent' then
    return null;
  end if;
  select * into v_lead from public.leads where id = new.lead_id;
  insert into public.usage_events (org_id, session_id, consultant_id, event_type)
  values (v_lead.org_id, v_lead.session_id, v_lead.consultant_id, 'calculation_sent');
  update public.calc_sessions set status = 'shared' where id = v_lead.session_id and status = 'live';
  return null;
end $$;

create trigger lead_deliveries_record_effects
  after insert on public.lead_deliveries
  for each row execute function private.record_delivery_effects();

-- Dziennik zmian: dochodzi zmiana firmy (company_id). Służy też jako limit zmian NIP na sesję.
create or replace function private.log_session_changes() returns trigger
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
  if old.company_id is distinct from new.company_id then
    insert into public.calc_events (org_id, session_id, actor, actor_id, field, old_value, new_value)
    values (new.org_id, new.id, v_actor, v_uid, 'company_id', to_jsonb(old.company_id), to_jsonb(new.company_id));
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- RPC (tylko service role — wołane z Edge Functions)
-- ---------------------------------------------------------------------------
-- Przypina firmę do sesji (po tokenie). Atomowo: zapis/odświeżenie firmy + zmiana company_id.
-- NIP można zmieniać do chwili utworzenia leada, najwyżej 10 razy na sesję (limit zapytań do GUS).
create function public.attach_company_to_session(p_token text, p_company jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  s public.calc_sessions;
  v_nip text := p_company ->> 'nip';
  v_status text := coalesce(p_company ->> 'gus_status', 'found');
  v_company_id uuid;
begin
  select * into s from public.calc_sessions where token = p_token and status <> 'archived' for update;
  if not found then
    raise exception 'Sesja nie istnieje' using errcode = 'AT001';
  end if;
  if v_nip is null or v_nip !~ '^[0-9]{10}$' then
    raise exception 'Niepoprawny NIP' using errcode = '22023';
  end if;

  select c.id into v_company_id from public.companies c where c.org_id = s.org_id and c.nip = v_nip;

  -- Ta sama firma jest już przypięta — nic do zrobienia.
  if v_company_id is not null and s.company_id = v_company_id then
    return v_company_id;
  end if;

  if exists (select 1 from public.leads l where l.session_id = s.id) then
    raise exception 'NIP jest zablokowany po utworzeniu leada' using errcode = 'AT002';
  end if;
  if (select count(*) from public.calc_events e where e.session_id = s.id and e.field = 'company_id') >= 10 then
    raise exception 'Przekroczono limit zmian NIP w sesji' using errcode = 'AT003';
  end if;

  if v_company_id is null then
    insert into public.companies (
      org_id, nip, regon, name, street, building_no, unit_no, postal_code, city, voivodeship,
      gus_type, gus_status, gus_raw, fetched_at
    ) values (
      s.org_id, v_nip, p_company ->> 'regon', p_company ->> 'name', p_company ->> 'street',
      p_company ->> 'building_no', p_company ->> 'unit_no', p_company ->> 'postal_code', p_company ->> 'city',
      p_company ->> 'voivodeship', p_company ->> 'gus_type', v_status, p_company -> 'gus_raw', now()
    ) returning id into v_company_id;
  elsif v_status = 'found' and not exists (select 1 from public.leads l where l.company_id = v_company_id) then
    -- Odświeżenie danych z GUS, o ile firma nie jest jeszcze zablokowana. Niedostępny GUS niczego nie nadpisuje.
    update public.companies set
      regon = p_company ->> 'regon', name = p_company ->> 'name', street = p_company ->> 'street',
      building_no = p_company ->> 'building_no', unit_no = p_company ->> 'unit_no',
      postal_code = p_company ->> 'postal_code', city = p_company ->> 'city',
      voivodeship = p_company ->> 'voivodeship', gus_type = p_company ->> 'gus_type',
      gus_status = 'found', gus_raw = p_company -> 'gus_raw', fetched_at = now()
    where id = v_company_id;
  end if;

  update public.calc_sessions set company_id = v_company_id where id = s.id;
  return v_company_id;
end $$;

-- Bramka przed wysyłką kalkulacji: sprawdza warunki, zamraża stan (raz na sesję) i zapisuje leada.
-- inputs i params snapshotu kopiuje z wiersza sesji (nie ufa wejściu); z p_calc bierze tylko wynik,
-- miks i wersję logiki policzone przez src/calc. p_expected_updated_at chroni przed zmianą stanu
-- między odczytem a zamrożeniem (AT004 — funkcja powtarza).
create function public.prepare_calculation_delivery(
  p_token text, p_email text, p_calc jsonb, p_expected_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.calc_sessions;
  v_email text := lower(btrim(p_email));
  v_snapshot public.calc_snapshots;
  v_lead public.leads;
  v_sent integer;
  v_sent_email text;
  v_created boolean := false;
begin
  select * into s from public.calc_sessions where token = p_token and status <> 'archived' for update;
  if not found then
    raise exception 'Sesja nie istnieje' using errcode = 'AT001';
  end if;
  if not s.revealed or s.company_id is null then
    raise exception 'Sesja nie jest gotowa do wysłania kalkulacji' using errcode = 'AT005';
  end if;

  select count(*), (array_agg(l.email order by d.id))[1]
    into v_sent, v_sent_email
  from public.lead_deliveries d
  join public.leads l on l.id = d.lead_id
  where l.session_id = s.id and d.status = 'sent';

  if v_sent >= 3 then
    raise exception 'Przekroczono limit wysyłek kalkulacji' using errcode = 'AT003';
  end if;
  if v_sent > 0 and v_sent_email is distinct from v_email then
    raise exception 'Adres e-mail jest zablokowany po pierwszej wysyłce' using errcode = 'AT002';
  end if;

  select * into v_snapshot from public.calc_snapshots where session_id = s.id;
  if not found then
    if s.updated_at is distinct from p_expected_updated_at then
      raise exception 'Stan sesji zmienił się w trakcie' using errcode = 'AT004';
    end if;
    insert into public.calc_snapshots (org_id, session_id, inputs, params, result, mix, calc_version)
    values (s.org_id, s.id, s.inputs, s.params, p_calc -> 'result', p_calc -> 'mix', p_calc ->> 'calc_version')
    returning * into v_snapshot;
    v_created := true;
  end if;

  -- Lead dla tego adresu w tej sesji (nie „ostatni”: znaczniki czasu w jednej transakcji bywają równe).
  select * into v_lead from public.leads where session_id = s.id and email = v_email order by created_at desc, id desc limit 1;
  if not found then
    insert into public.leads (org_id, session_id, consultant_id, company_id, snapshot_id, email)
    values (s.org_id, s.id, s.consultant_id, s.company_id, v_snapshot.id, v_email)
    returning * into v_lead;
  end if;

  return jsonb_build_object(
    'snapshot', to_jsonb(v_snapshot),
    'lead_id', v_lead.id,
    'sent_count', v_sent,
    'created_snapshot', v_created
  );
end $$;

revoke execute on function public.attach_company_to_session(text, jsonb) from public, anon, authenticated;
grant execute on function public.attach_company_to_session(text, jsonb) to service_role;
revoke execute on function public.prepare_calculation_delivery(text, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.prepare_calculation_delivery(text, text, jsonb, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Granty i RLS: klient tylko czyta, widoczność dziedziczona z calc_sessions
-- (konsultant swoje, właściciel/admin całą organizację; operator nic).
-- ---------------------------------------------------------------------------
grant select on public.companies to authenticated;
grant select on public.leads to authenticated;
grant select on public.lead_deliveries to authenticated;

alter table public.companies enable row level security;
alter table public.leads enable row level security;
alter table public.lead_deliveries enable row level security;

create policy companies_select on public.companies for select to authenticated
  using (id in (select s.company_id from public.calc_sessions s where s.company_id is not null));
create policy leads_select on public.leads for select to authenticated
  using (session_id in (select s.id from public.calc_sessions s));
create policy lead_deliveries_select on public.lead_deliveries for select to authenticated
  using (lead_id in (select l.id from public.leads l));

revoke execute on all functions in schema private from public, anon;
