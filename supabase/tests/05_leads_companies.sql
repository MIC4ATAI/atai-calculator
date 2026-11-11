-- Etap 2: firmy z GUS, leady, dostawy kalkulacji, zamrożenie stanu (RPC dla service role),
-- RLS i niezmienność nowych tabel.
--   operator=...01  marek=...02 (owner MITAX, konsultant AT AI)  ola=...03 (konsultant MITAX)
--   admin MITAX=...04  wspolnik=...05 (owner AT AI)  jan=...06   MITAX=10..01  AT AI=10..02
-- NIP-y: A=5261040567, B=5260250995 (poprawne sumy kontrolne; DB sprawdza tylko 10 cyfr).
begin;
create extension if not exists pgtap with schema extensions;

create schema tests;
grant usage on schema tests to service_role;
create function tests.login_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  set local role authenticated;
end $$;
create function tests.login_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
end $$;
create function tests.login_as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role service_role;
end $$;
-- Ładunek firmy jak z Edge Function: pełny albo „GUS niedostępny” (sam NIP i status).
create function tests.company_json(p_nip text, p_name text, p_status text default 'found') returns jsonb
language sql as $$
  select case when p_status = 'unavailable'
    then jsonb_build_object('nip', p_nip, 'gus_status', 'unavailable')
    else jsonb_build_object('nip', p_nip, 'name', p_name, 'city', 'Warszawa', 'postal_code', '02-674',
           'street', 'ul. Test-Krucza', 'building_no', '12', 'gus_type', 'P', 'gus_status', 'found',
           'gus_raw', jsonb_build_object('Nip', p_nip))
  end
$$;

select plan(89);

-- Dane: s1 Ola/MITAX (odsłonięta, dane do snapshotu), s2 Marek/MITAX, s3 Jan/AT AI, s4 i s5 Ola/MITAX,
-- s6 Ola/MITAX odsłonięta bez firmy, s7 Ola/MITAX nieodsłonięta, s8 Ola/MITAX (limit NIP), s9 zarchiwizowana.
insert into public.calc_sessions (id, org_id, consultant_id, token, inputs, params, revealed, status) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'tok-ola-sess01', '{"kh":100,"kpir":200}', '{"celKorzysci":10000}', true, 'live'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'tok-marek-sess2', '{}', '{}', true, 'live'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000006', 'tok-jan-sess003', '{}', '{}', true, 'live'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'tok-ola-sess04', '{}', '{}', true, 'live'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'tok-ola-sess05', '{}', '{}', true, 'live'),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'tok-ola-sess06', '{}', '{}', true, 'live'),
  ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'tok-ola-sess07', '{}', '{}', false, 'live'),
  ('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'tok-ola-sess08', '{}', '{}', true, 'live'),
  ('20000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'tok-arch-sess09', '{}', '{}', true, 'archived');

-- attach_company_to_session --------------------------------------------------
select tests.login_as_service();
select lives_ok(
  $$select public.attach_company_to_session('tok-ola-sess01', tests.company_json('5261040567', 'T-MOBILE POLSKA SA'))$$,
  'attach: firma przypięta do sesji');
reset role;
select is(
  (select company_id from public.calc_sessions where token = 'tok-ola-sess01'),
  (select id from public.companies where org_id = '10000000-0000-4000-8000-000000000001' and nip = '5261040567'),
  'attach: sesja wskazuje firmę z NIP-em w swojej organizacji');
select is(
  (select count(*)::int from public.calc_events where session_id = '20000000-0000-4000-8000-000000000001' and field = 'company_id' and actor = 'guest'),
  1, 'attach: zmiana firmy trafia do dziennika (aktor guest)');

select tests.login_as_service();
select is(
  public.attach_company_to_session('tok-ola-sess01', tests.company_json('5261040567', 'INNA NAZWA')),
  (select id from public.companies where org_id = '10000000-0000-4000-8000-000000000001' and nip = '5261040567'),
  'attach: ta sama firma jest idempotentna (ten sam identyfikator)');
reset role;
select is(
  (select name from public.companies where org_id = '10000000-0000-4000-8000-000000000001' and nip = '5261040567'),
  'T-MOBILE POLSKA SA', 'attach: ponowne przypięcie niczego nie nadpisuje');
select is(
  (select count(*)::int from public.calc_events where session_id = '20000000-0000-4000-8000-000000000001' and field = 'company_id'),
  1, 'attach: powtórka nie dopisuje zdarzenia');

select tests.login_as_service();
select is(
  public.attach_company_to_session('tok-marek-sess2', tests.company_json('5261040567', 'T-MOBILE POLSKA SA')),
  (select id from public.companies where org_id = '10000000-0000-4000-8000-000000000001' and nip = '5261040567'),
  'attach: firma jest współdzielona przez sesje tej samej organizacji');
select lives_ok(
  $$select public.attach_company_to_session('tok-jan-sess003', tests.company_json('5261040567', 'T-MOBILE POLSKA SA'))$$,
  'attach: ten sam NIP w innej organizacji');
reset role;
select is(
  (select count(distinct id)::int from public.companies where nip = '5261040567'),
  2, 'attach: firmy są osobne dla każdej organizacji (ten NIP = 2 wiersze)');

select tests.login_as_service();
select throws_ok($$select public.attach_company_to_session('tok-nie-ma-takiej', tests.company_json('5261040567', 'X'))$$,
  'AT001', null, 'attach: nieznany token');
select throws_ok($$select public.attach_company_to_session('tok-arch-sess09', tests.company_json('5261040567', 'X'))$$,
  'AT001', null, 'attach: zarchiwizowana sesja');
select throws_ok($$select public.attach_company_to_session('tok-ola-sess04', '{"nip":"123","gus_status":"found"}')$$,
  '22023', null, 'attach: niepoprawny NIP (nie 10 cyfr)');

-- GUS niedostępny: firma bez danych; potem nigdy nie nadpisuje dobrych danych
select lives_ok(
  $$select public.attach_company_to_session('tok-ola-sess07', tests.company_json('5260250995', null, 'unavailable'))$$,
  'attach: GUS niedostępny — firma z samym NIP-em');
reset role;
select is(
  (select gus_status || '/' || coalesce(name, 'brak') from public.companies where org_id = '10000000-0000-4000-8000-000000000001' and nip = '5260250995'),
  'unavailable/brak', 'attach: firma bez nazwy ma status unavailable');
select tests.login_as_service();
select lives_ok(
  $$select public.attach_company_to_session('tok-ola-sess04', tests.company_json('5261040567', null, 'unavailable'))$$,
  'attach: kolejna sesja, GUS znów niedostępny');
reset role;
select is(
  (select name from public.companies where org_id = '10000000-0000-4000-8000-000000000001' and nip = '5261040567'),
  'T-MOBILE POLSKA SA', 'attach: niedostępny GUS nie nadpisuje danych, które już mamy');
select tests.login_as_service();
select lives_ok(
  $$select public.attach_company_to_session('tok-ola-sess05', tests.company_json('5261040567', 'T-MOBILE POLSKA S.A.'))$$,
  'attach: odświeżenie danych z GUS, gdy firma nie jest zablokowana');
reset role;
select is(
  (select name from public.companies where org_id = '10000000-0000-4000-8000-000000000001' and nip = '5261040567'),
  'T-MOBILE POLSKA S.A.', 'attach: dane firmy odświeżone');
select tests.login_as_service();
select lives_ok(
  $$select public.attach_company_to_session('tok-ola-sess05', tests.company_json('5261040567', 'T-MOBILE POLSKA SA'))$$,
  'attach: wracamy do poprzedniej nazwy (przygotowanie danych)');
reset role;
update public.companies set name = 'T-MOBILE POLSKA SA' where org_id = '10000000-0000-4000-8000-000000000001' and nip = '5261040567';

-- Limit zmian NIP: 10 na sesję, 11. zmiana odrzucona
select tests.login_as_service();
select lives_ok(
  $q$do $b$ begin
      for i in 1..10 loop
        perform public.attach_company_to_session('tok-ola-sess08', tests.company_json('90000000' || lpad(i::text, 2, '0'), 'FIRMA ' || i));
      end loop;
    end $b$ $q$,
  'limit: 10 zmian NIP w jednej sesji przechodzi');
select throws_ok($$select public.attach_company_to_session('tok-ola-sess08', tests.company_json('9000000099', 'FIRMA 11'))$$,
  'AT003', null, 'limit: 11. zmiana NIP odrzucona');

-- Klient nie woła RPC serwera
reset role; select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
-- Uwaga: bez pomocników ze schematu tests — rola klienta nie ma do niego dostępu i test wywróciłby się wcześniej.
select throws_ok($$select public.attach_company_to_session('tok-ola-sess01', '{"nip":"5261040567","gus_status":"found"}')$$,
  '42501', null, 'attach: niedostępne dla zalogowanego konsultanta');
select throws_ok($$select public.prepare_calculation_delivery('tok-ola-sess01', 'a@b.test', '{}', now())$$,
  '42501', null, 'prepare: niedostępne dla zalogowanego konsultanta');
reset role; select tests.login_as_anon();
select throws_ok($$select public.attach_company_to_session('tok-ola-sess01', '{"nip":"5261040567","gus_status":"found"}')$$,
  '42501', null, 'attach: niedostępne dla anon');
select throws_ok($$select public.prepare_calculation_delivery('tok-ola-sess01', 'a@b.test', '{}', now())$$,
  '42501', null, 'prepare: niedostępne dla anon');
reset role;

-- prepare_calculation_delivery: warunki wstępne ---------------------------------
select tests.login_as_service();
select throws_ok($$select public.prepare_calculation_delivery('tok-nie-ma-takiej', 'a@b.test', '{}', now())$$,
  'AT001', null, 'prepare: nieznany token');
select throws_ok($$select public.prepare_calculation_delivery('tok-arch-sess09', 'a@b.test', '{}', now())$$,
  'AT001', null, 'prepare: zarchiwizowana sesja');
select throws_ok($$select public.prepare_calculation_delivery('tok-ola-sess06', 'a@b.test', '{}', now())$$,
  'AT005', null, 'prepare: sesja bez firmy nie jest gotowa');
select throws_ok($$select public.prepare_calculation_delivery('tok-ola-sess07', 'a@b.test', '{}', now())$$,
  'AT005', null, 'prepare: sesja z nieodsłoniętym wynikiem nie jest gotowa');
select throws_ok(
  $$select public.prepare_calculation_delivery('tok-ola-sess01', 'a@b.test', '{"result":{},"mix":{},"calc_version":"1.1.0"}', now() - interval '1 hour')$$,
  'AT004', null, 'prepare: zmieniony stan sesji (nieaktualny updated_at) — powtórz');

-- Zamrożenie: snapshot z danych sesji, nie z ładunku
select is(
  public.prepare_calculation_delivery(
    'tok-ola-sess01', ' Rozmowca@Example.TEST ',
    '{"result":{"h":121},"mix":{"kh":20},"calc_version":"1.1.0","inputs":{"evil":1},"params":{"celKorzysci":1}}',
    (select updated_at from public.calc_sessions where token = 'tok-ola-sess01')) ->> 'created_snapshot',
  'true', 'prepare: pierwsze wywołanie tworzy snapshot');
reset role;
select is(
  (select inputs from public.calc_snapshots where session_id = '20000000-0000-4000-8000-000000000001'),
  '{"kh":100,"kpir":200}'::jsonb, 'snapshot: dane wejściowe kopiowane z sesji, nie z ładunku');
select is(
  (select params from public.calc_snapshots where session_id = '20000000-0000-4000-8000-000000000001'),
  '{"celKorzysci":10000}'::jsonb, 'snapshot: założenia kopiowane z sesji, nie z ładunku');
select is(
  (select result::text || '|' || mix::text || '|' || calc_version from public.calc_snapshots where session_id = '20000000-0000-4000-8000-000000000001'),
  '{"h": 121}|{"kh": 20}|1.1.0', 'snapshot: wynik, miks i wersja logiki z ładunku');
select is(
  (select string_agg(email, ',') from public.leads where session_id = '20000000-0000-4000-8000-000000000001'),
  'rozmowca@example.test', 'lead: e-mail znormalizowany (małe litery, bez spacji)');

select tests.login_as_service();
select is(
  public.prepare_calculation_delivery(
    'tok-ola-sess01', 'rozmowca@example.test',
    '{"result":{"h":999},"mix":{},"calc_version":"9.9.9"}',
    (select updated_at from public.calc_sessions where token = 'tok-ola-sess01')) ->> 'created_snapshot',
  'false', 'prepare: kolejne wywołanie nie zamraża stanu ponownie');
reset role;
select is(
  (select count(*)::int from public.leads where session_id = '20000000-0000-4000-8000-000000000001'),
  1, 'lead: ten sam adres nie tworzy drugiego leada');
select is(
  (select result from public.calc_snapshots where session_id = '20000000-0000-4000-8000-000000000001'),
  '{"h":121}'::jsonb, 'snapshot: niezmieniony przy kolejnym wywołaniu');

-- Literówka w adresie, zanim cokolwiek wysłano: nowy lead, ten sam snapshot
select tests.login_as_service();
select lives_ok(
  $$select public.prepare_calculation_delivery('tok-ola-sess01', 'poprawny@example.test', '{"result":{},"mix":{},"calc_version":"1.1.0"}',
      (select updated_at from public.calc_sessions where token = 'tok-ola-sess01'))$$,
  'prepare: inny adres, dopóki nic nie wysłano, jest dozwolony');
select throws_ok(
  $$select public.prepare_calculation_delivery('tok-ola-sess01', 'to-nie-email', '{"result":{},"mix":{},"calc_version":"1.1.0"}',
      (select updated_at from public.calc_sessions where token = 'tok-ola-sess01'))$$,
  '23514', null, 'prepare: niepoprawny adres e-mail odrzucony');
reset role;
select is(
  (select count(*)::int from public.leads where session_id = '20000000-0000-4000-8000-000000000001'),
  2, 'lead: poprawiony adres to drugi wiersz (tylko dopisywanie)');
select is(
  (select count(*)::int from public.calc_snapshots where session_id = '20000000-0000-4000-8000-000000000001'),
  1, 'snapshot: nadal jeden na sesję');

-- Dostawy: nieudana nic nie zmienia, udana liczy się do użycia i oznacza sesję jako udostępnioną
insert into public.lead_deliveries (org_id, lead_id, status, provider, error)
  select org_id, id, 'failed', 'mailpit', 'timeout' from public.leads
  where session_id = '20000000-0000-4000-8000-000000000001' and email = 'poprawny@example.test';
select is(
  (select count(*)::int from public.usage_events where session_id = '20000000-0000-4000-8000-000000000001' and event_type = 'calculation_sent'),
  0, 'dostawa nieudana nie liczy się do użycia');
select is((select status from public.calc_sessions where token = 'tok-ola-sess01'), 'live',
  'dostawa nieudana nie zmienia statusu sesji');
insert into public.lead_deliveries (org_id, lead_id, status, provider, provider_message_id)
  select org_id, id, 'sent', 'mailpit', 'm-1' from public.leads
  where session_id = '20000000-0000-4000-8000-000000000001' and email = 'poprawny@example.test';
select is(
  (select count(*)::int from public.usage_events where session_id = '20000000-0000-4000-8000-000000000001' and event_type = 'calculation_sent'),
  1, 'dostawa udana = jedno zdarzenie użycia calculation_sent');
select is((select status from public.calc_sessions where token = 'tok-ola-sess01'), 'shared',
  'dostawa udana: sesja przechodzi do „udostępniona”');
select throws_ok(
  $$insert into public.lead_deliveries (org_id, lead_id, status, provider)
    select org_id, id, 'weird', 'mailpit' from public.leads limit 1$$,
  '23514', null, 'dostawa: nieznany status odrzucony');
select throws_ok(
  $$insert into public.lead_deliveries (org_id, lead_id, status, provider)
    select org_id, id, 'sent', 'sendgrid' from public.leads limit 1$$,
  '23514', null, 'dostawa: nieznany dostawca odrzucony');

-- Po udanej wysyłce: adres zablokowany, ponowna wysyłka na ten sam adres działa, do 3 wysyłek
select tests.login_as_service();
select throws_ok(
  $$select public.prepare_calculation_delivery('tok-ola-sess01', 'inny@example.test', '{"result":{},"mix":{},"calc_version":"1.1.0"}', now())$$,
  'AT002', null, 'prepare: po udanej wysyłce inny adres jest zablokowany');
select is(
  public.prepare_calculation_delivery('tok-ola-sess01', 'poprawny@example.test', '{"result":{},"mix":{},"calc_version":"1.1.0"}', now()) ->> 'sent_count',
  '1', 'prepare: ponowna wysyłka na zablokowany adres działa (licznik 1)');
reset role;
insert into public.lead_deliveries (org_id, lead_id, status, provider, provider_message_id)
  select org_id, id, 'sent', 'mailpit', 'm-' || n from public.leads, generate_series(2, 3) n
  where session_id = '20000000-0000-4000-8000-000000000001' and email = 'poprawny@example.test';
select tests.login_as_service();
select throws_ok(
  $$select public.prepare_calculation_delivery('tok-ola-sess01', 'poprawny@example.test', '{"result":{},"mix":{},"calc_version":"1.1.0"}', now())$$,
  'AT003', null, 'prepare: czwarta wysyłka odrzucona (limit 3)');
-- Zmiana NIP po utworzeniu leada
select throws_ok($$select public.attach_company_to_session('tok-ola-sess01', tests.company_json('5260250995', 'ORANGE'))$$,
  'AT002', null, 'attach: NIP zablokowany po utworzeniu leada');
select is(
  public.attach_company_to_session('tok-ola-sess01', tests.company_json('5261040567', 'COKOLWIEK')),
  (select id from public.companies where org_id = '10000000-0000-4000-8000-000000000001' and nip = '5261040567'),
  'attach: ta sama firma po utworzeniu leada nadal przechodzi (idempotentnie)');
reset role;

-- Blokada danych firmy ---------------------------------------------------------
select throws_ok(
  $$update public.companies set name = 'ZMIANA' where org_id = '10000000-0000-4000-8000-000000000001' and nip = '5261040567'$$,
  '42501', 'Dane firmy są zablokowane po utworzeniu leada', 'firma z leadem: UPDATE zablokowany (nawet dla postgres)');
select throws_ok(
  $$delete from public.companies where org_id = '10000000-0000-4000-8000-000000000001' and nip = '5261040567'$$,
  '42501', 'Dane firmy są zablokowane po utworzeniu leada', 'firma z leadem: DELETE zablokowany');
select lives_ok(
  $$update public.companies set name = 'ZMIANA' where org_id = '10000000-0000-4000-8000-000000000001' and nip = '5260250995'$$,
  'firma bez leada nadal da się odświeżyć');

-- Tylko dopisywanie ------------------------------------------------------------
select throws_ok($$update public.leads set email = 'x@y.test'$$, '42501',
  'Tabela leads jest tylko do dopisywania (UPDATE zablokowane)', 'leads: UPDATE zablokowany (trigger)');
select throws_ok($$delete from public.leads$$, '42501',
  'Tabela leads jest tylko do dopisywania (DELETE zablokowane)', 'leads: DELETE zablokowany (trigger)');
select throws_ok($$truncate public.leads$$, '0A000', null,
  'leads: TRUNCATE zatrzymuje klucz obcy z lead_deliveries');
select throws_ok($$truncate public.leads cascade$$, '42501',
  'Tabela leads jest tylko do dopisywania (TRUNCATE zablokowane)', 'leads: TRUNCATE ... CASCADE zablokowany (trigger)');
select throws_ok($$update public.lead_deliveries set status = 'failed'$$, '42501',
  'Tabela lead_deliveries jest tylko do dopisywania (UPDATE zablokowane)', 'lead_deliveries: UPDATE zablokowany (trigger)');
select throws_ok($$delete from public.lead_deliveries$$, '42501',
  'Tabela lead_deliveries jest tylko do dopisywania (DELETE zablokowane)', 'lead_deliveries: DELETE zablokowany (trigger)');
select throws_ok($$truncate public.lead_deliveries$$, '42501',
  'Tabela lead_deliveries jest tylko do dopisywania (TRUNCATE zablokowane)', 'lead_deliveries: TRUNCATE zablokowany (trigger)');

-- RLS: widoczność dziedziczona z sesji; operator i anon nic nie widzą ---------------
-- Stan: firma A (MITAX) przypięta do s1 (Ola) i s2 (Marek) oraz s4/s5 (Ola); firma B tylko do s7 (Ola);
-- firma A' (AT AI) do s3 (Jan); leady i dostawy tylko w s1 (Ola).
select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select is((select count(*)::int from public.companies where nip = '5261040567'), 1, 'RLS: konsultant widzi firmę swojej sesji (jedną, bez firmy z innej organizacji)');
select is((select count(*)::int from public.companies where nip = '5260250995'), 1, 'RLS: konsultant widzi też drugą swoją firmę');
select is((select count(*)::int from public.leads), 2, 'RLS: konsultant widzi leady swojej sesji');
select is((select count(*)::int from public.lead_deliveries), 4, 'RLS: konsultant widzi dostawy swojej sesji');

reset role; select tests.login_as('00000000-0000-4000-8000-000000000002'); -- Marek (s2 z firmą A; MITAX owner widzi organizację)
select is((select count(*)::int from public.leads), 2, 'RLS: właściciel MITAX widzi leady organizacji');

reset role; select tests.login_as('00000000-0000-4000-8000-000000000004'); -- admin MITAX
select is((select count(*)::int from public.companies where nip = '5261040567'), 1, 'RLS: admin widzi firmy organizacji (bez firmy AT AI)');
select is((select count(*)::int from public.leads), 2, 'RLS: admin widzi leady organizacji');
select is((select count(*)::int from public.lead_deliveries), 4, 'RLS: admin widzi dostawy organizacji');

reset role; select tests.login_as('00000000-0000-4000-8000-000000000006'); -- Jan (AT AI)
select is((select count(*)::int from public.companies where nip = '5261040567'), 1, 'RLS: konsultant AT AI widzi tylko firmę AT AI');
select is((select count(*)::int from public.companies where nip = '5260250995'), 0, 'RLS: konsultant AT AI nie widzi firm MITAX');
select is((select count(*)::int from public.leads), 0, 'RLS: konsultant AT AI nie widzi leadów MITAX');
select is((select count(*)::int from public.lead_deliveries), 0, 'RLS: konsultant AT AI nie widzi dostaw MITAX');

reset role; select tests.login_as('00000000-0000-4000-8000-000000000005'); -- właściciel AT AI
select is((select count(*)::int from public.leads), 0, 'RLS: właściciel AT AI nie widzi leadów MITAX');

reset role; select tests.login_as('00000000-0000-4000-8000-000000000001'); -- operator
select is((select count(*)::int from public.companies), 0, 'RLS: operator nie widzi firm');
select is((select count(*)::int from public.leads), 0, 'RLS: operator nie widzi leadów');
select is((select count(*)::int from public.lead_deliveries), 0, 'RLS: operator nie widzi dostaw');
select is((select count(*)::int from public.usage_events where event_type = 'calculation_sent'), 3,
  'RLS: operator widzi użycie (rozliczenia): trzy wysłane kalkulacje');

reset role; select tests.login_as_anon();
select throws_ok($$select count(*) from public.companies$$, '42501', null, 'RLS: anon nie ma dostępu do companies');
select throws_ok($$select count(*) from public.leads$$, '42501', null, 'RLS: anon nie ma dostępu do leads');
select throws_ok($$select count(*) from public.lead_deliveries$$, '42501', null, 'RLS: anon nie ma dostępu do lead_deliveries');

-- Klient nie pisze do nowych tabel -----------------------------------------------
reset role; select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select throws_ok(
  $$insert into public.companies (org_id, nip) values ('10000000-0000-4000-8000-000000000001', '1111111111')$$,
  '42501', null, 'zapis klienta: companies — brak INSERT');
select throws_ok(
  $$update public.companies set name = 'X'$$, '42501', null, 'zapis klienta: companies — brak UPDATE');
select throws_ok(
  $$delete from public.companies$$, '42501', null, 'zapis klienta: companies — brak DELETE');
select throws_ok(
  $$insert into public.leads (org_id, session_id, consultant_id, company_id, snapshot_id, email)
    select org_id, session_id, consultant_id, company_id, snapshot_id, 'x@y.test' from public.leads limit 1$$,
  '42501', null, 'zapis klienta: leads — brak INSERT');
select throws_ok(
  $$insert into public.lead_deliveries (org_id, lead_id, status, provider)
    select org_id, id, 'sent', 'mailpit' from public.leads limit 1$$,
  '42501', null, 'zapis klienta: lead_deliveries — brak INSERT');
select throws_ok(
  $$update public.calc_sessions set company_id = null where token = 'tok-ola-sess01'$$,
  '42501', null, 'zapis klienta: konsultant nie zmienia company_id sesji (tylko RPC)');

select * from finish();
rollback;
