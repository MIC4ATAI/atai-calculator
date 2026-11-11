-- Poprawka do attach_company_to_session: świeże dane z GUS odświeżają firmę także wtedy, gdy jest już
-- przypięta do tej samej sesji (np. rozmówca ponawia NIP po wcześniejszej awarii GUS). Wcześniej
-- RPC kończyło się od razu i firma „bez danych” zostawała taka do końca sesji.
-- Zablokowana firma (istnieje lead) nadal nie jest zmieniana, a ładunek „unavailable” niczego nie nadpisuje.

create function private.refresh_company_from_gus(p_company_id uuid, p_company jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_company ->> 'gus_status', 'found') <> 'found' then
    return;
  end if;
  if exists (select 1 from public.leads l where l.company_id = p_company_id) then
    return;
  end if;
  update public.companies set
    regon = p_company ->> 'regon', name = p_company ->> 'name', street = p_company ->> 'street',
    building_no = p_company ->> 'building_no', unit_no = p_company ->> 'unit_no',
    postal_code = p_company ->> 'postal_code', city = p_company ->> 'city',
    voivodeship = p_company ->> 'voivodeship', gus_type = p_company ->> 'gus_type',
    gus_status = 'found', gus_raw = p_company -> 'gus_raw', fetched_at = now()
  where id = p_company_id;
end $$;

revoke execute on function private.refresh_company_from_gus(uuid, jsonb) from public, anon;

create or replace function public.attach_company_to_session(p_token text, p_company jsonb) returns uuid
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

  -- Ta sama firma jest już przypięta: najwyżej odświeżamy jej dane (jeśli przyszły świeże z GUS).
  if v_company_id is not null and s.company_id = v_company_id then
    perform private.refresh_company_from_gus(v_company_id, p_company);
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
  else
    -- Firma już istnieje w tej organizacji: odświeżamy ją świeżymi danymi z GUS (o ile nie jest zablokowana).
    perform private.refresh_company_from_gus(v_company_id, p_company);
  end if;

  update public.calc_sessions set company_id = v_company_id where id = s.id;
  return v_company_id;
end $$;

revoke execute on function public.attach_company_to_session(text, jsonb) from public, anon, authenticated;
grant execute on function public.attach_company_to_session(text, jsonb) to service_role;
