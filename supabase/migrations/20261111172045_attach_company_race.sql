-- Poprawka wyścigu w attach_company_to_session: dwie równoległe sesje tej samej organizacji, które jednocześnie
-- wpisują NOWY NIP, obie nie widzą jeszcze firmy i obie próbują ją wstawić — przegrywająca dostawała błąd
-- unikalności (org_id, nip) i funkcja odpowiadała 500. Teraz wstawienie jest `on conflict do nothing`, a przy
-- konflikcie korzystamy z wiersza dodanego przez konkurenta (wykryte przez test e2e, który odpala sesje równolegle).

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
    )
    on conflict (org_id, nip) do nothing
    returning id into v_company_id;

    if v_company_id is null then
      -- Równoległa sesja dodała tę firmę między naszym odczytem a wstawieniem: bierzemy jej wiersz.
      select c.id into v_company_id from public.companies c where c.org_id = s.org_id and c.nip = v_nip;
      perform private.refresh_company_from_gus(v_company_id, p_company);
    end if;
  else
    -- Firma już istnieje w tej organizacji: odświeżamy ją świeżymi danymi z GUS (o ile nie jest zablokowana).
    perform private.refresh_company_from_gus(v_company_id, p_company);
  end if;

  update public.calc_sessions set company_id = v_company_id where id = s.id;
  return v_company_id;
end $$;

revoke execute on function public.attach_company_to_session(text, jsonb) from public, anon, authenticated;
grant execute on function public.attach_company_to_session(text, jsonb) to service_role;
