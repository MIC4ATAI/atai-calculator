-- Tabele tylko do dopisywania: calc_snapshots (zamrożony stan), calc_events, usage_events.
-- Zmiana i usunięcie muszą być niemożliwe dla klienta (granty) i dla service role / postgres (trigger).
begin;
create extension if not exists pgtap with schema extensions;

create schema tests;
create function tests.login_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  set local role authenticated;
end $$;
create function tests.login_as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role service_role;
end $$;

select plan(31);

-- Dane: s1 (Ola/MITAX), s3 (Jan/AT AI); po jednym snapshocie i zdarzeniu dziennika w s1.
insert into public.calc_sessions (id, org_id, consultant_id) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000006');
update public.calc_sessions set revealed = true where id = '20000000-0000-4000-8000-000000000001';
insert into public.calc_snapshots (id, org_id, session_id, inputs, params, result, mix, calc_version)
values ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001', '{"kh":100}', '{}', '{}', '{}', '1.0.0');

-- calc_snapshots: klient nie tworzy (zamrożenie robi serwer przez RPC), jeden snapshot na sesję ---
select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select throws_ok(
  $$insert into public.calc_snapshots (org_id, session_id, inputs, params, result, mix, calc_version)
    values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '{}', '{}', '{}', '{}', '1.0.0')$$,
  '42501', null, 'konsultant nie tworzy snapshotu nawet własnej sesji (brak grantu INSERT; zamrożenie robi serwer)');
select throws_ok(
  $$insert into public.calc_snapshots (org_id, session_id, inputs, params, result, mix, calc_version)
    values ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', '{}', '{}', '{}', '{}', '1.0.0')$$,
  '42501', null, 'konsultant nie tworzy snapshotu sesji z innej organizacji');
reset role;
select throws_ok(
  $$insert into public.calc_snapshots (org_id, session_id, inputs, params, result, mix, calc_version)
    values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '{}', '{}', '{}', '{}', '1.0.0')$$,
  '23505', null, 'druga zamrożona kopia tej samej sesji jest odrzucona (jeden snapshot na sesję)');
select throws_ok(
  $$insert into public.calc_snapshots (org_id, session_id, inputs, params, result, mix, calc_version)
    values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', '{}', '{}', '{}', '{}', '1.0.0')$$,
  '23503', null, 'snapshot z org_id niezgodnym z organizacją sesji jest odrzucony (klucz złożony)');

-- calc_snapshots: widoczność ------------------------------------------------
select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select is((select count(*)::int from public.calc_snapshots), 1, 'konsultant widzi snapshot własnej sesji');
reset role; select tests.login_as('00000000-0000-4000-8000-000000000006'); -- Jan (inna organizacja)
select is((select count(*)::int from public.calc_snapshots), 0, 'konsultant innej organizacji nie widzi snapshotów');
reset role; select tests.login_as('00000000-0000-4000-8000-000000000004'); -- admin MITAX
select is((select count(*)::int from public.calc_snapshots), 1, 'admin organizacji widzi snapshoty jej sesji');

-- calc_snapshots: klient nie zmienia ani nie usuwa ---------------------------
reset role; select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select throws_ok(
  $$update public.calc_snapshots set calc_version = 'x' where id = '30000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'konsultant nie zmienia snapshotu (brak grantu UPDATE)');
select throws_ok(
  $$delete from public.calc_snapshots where id = '30000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'konsultant nie usuwa snapshotu (brak grantu DELETE)');
reset role; select tests.login_as('00000000-0000-4000-8000-000000000004'); -- admin
select throws_ok(
  $$update public.calc_snapshots set inputs = '{}' where id = '30000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'admin organizacji nie zmienia snapshotu');
select throws_ok(
  $$delete from public.calc_snapshots where id = '30000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'admin organizacji nie usuwa snapshotu');

-- calc_snapshots: nawet service role i postgres (trigger) -------------------
reset role; select tests.login_as_service();
select throws_ok(
  $$update public.calc_snapshots set calc_version = 'x'$$,
  '42501', 'Tabela calc_snapshots jest tylko do dopisywania (UPDATE zablokowane)',
  'service role nie zmienia snapshotu (trigger)');
select throws_ok(
  $$delete from public.calc_snapshots$$,
  '42501', 'Tabela calc_snapshots jest tylko do dopisywania (DELETE zablokowane)',
  'service role nie usuwa snapshotu (trigger)');
reset role;
select throws_ok(
  $$update public.calc_snapshots set calc_version = 'x'$$,
  '42501', 'Tabela calc_snapshots jest tylko do dopisywania (UPDATE zablokowane)',
  'postgres nie zmienia snapshotu (trigger)');
select throws_ok(
  $$delete from public.calc_snapshots$$,
  '42501', 'Tabela calc_snapshots jest tylko do dopisywania (DELETE zablokowane)',
  'postgres nie usuwa snapshotu (trigger)');
-- Od etapu 2 do snapshotów odwołują się leady, więc zwykły TRUNCATE zatrzymuje klucz obcy (0A000);
-- TRUNCATE ... CASCADE omija to ograniczenie i musi trafić w nasz trigger.
select throws_ok(
  $$truncate public.calc_snapshots$$,
  '0A000', null,
  'postgres nie czyści tabeli snapshotów (TRUNCATE zatrzymuje klucz obcy z leads)');
select throws_ok(
  $$truncate public.calc_snapshots cascade$$,
  '42501', 'Tabela calc_snapshots jest tylko do dopisywania (TRUNCATE zablokowane)',
  'postgres nie czyści snapshotów nawet przez TRUNCATE ... CASCADE (trigger)');
select throws_ok(
  $$delete from public.calc_sessions where id = '20000000-0000-4000-8000-000000000001'$$,
  '23503', null, 'sesji ze snapshotem nie da się usunąć (klucz obcy RESTRICT)');
select is(
  (select calc_version from public.calc_snapshots where id = '30000000-0000-4000-8000-000000000001'),
  '1.0.0', 'snapshot został nietknięty');

-- calc_events: klient nie pisze, nikt nie zmienia ---------------------------
select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select throws_ok(
  $$insert into public.calc_events (org_id, session_id, actor, field)
    values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'consultant', 'kh')$$,
  '42501', null, 'klient nie dopisuje do calc_events (wpisuje trigger)');
select throws_ok($$update public.calc_events set field = 'x'$$, '42501', null,
  'klient nie zmienia calc_events');
select throws_ok($$delete from public.calc_events$$, '42501', null,
  'klient nie usuwa z calc_events');
reset role;
select throws_ok($$update public.calc_events set field = 'x'$$, '42501',
  'Tabela calc_events jest tylko do dopisywania (UPDATE zablokowane)', 'postgres nie zmienia calc_events (trigger)');
select throws_ok($$delete from public.calc_events$$, '42501',
  'Tabela calc_events jest tylko do dopisywania (DELETE zablokowane)', 'postgres nie usuwa z calc_events (trigger)');
select throws_ok($$truncate public.calc_events$$, '42501',
  'Tabela calc_events jest tylko do dopisywania (TRUNCATE zablokowane)', 'postgres nie czyści calc_events (TRUNCATE)');

-- usage_events: klient nie pisze, nikt nie zmienia ---------------------------
select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select throws_ok(
  $$insert into public.usage_events (org_id, event_type) values ('10000000-0000-4000-8000-000000000001', 'session_created')$$,
  '42501', null, 'klient nie dopisuje do usage_events (wpisuje trigger)');
select throws_ok($$update public.usage_events set event_type = 'session_created'$$, '42501', null,
  'klient nie zmienia usage_events');
select throws_ok($$delete from public.usage_events$$, '42501', null,
  'klient nie usuwa z usage_events');
reset role;
select throws_ok($$update public.usage_events set event_type = 'session_created'$$, '42501',
  'Tabela usage_events jest tylko do dopisywania (UPDATE zablokowane)', 'postgres nie zmienia usage_events (trigger)');
select throws_ok($$delete from public.usage_events$$, '42501',
  'Tabela usage_events jest tylko do dopisywania (DELETE zablokowane)', 'postgres nie usuwa z usage_events (trigger)');
select throws_ok($$truncate public.usage_events$$, '42501',
  'Tabela usage_events jest tylko do dopisywania (TRUNCATE zablokowane)', 'postgres nie czyści usage_events (TRUNCATE)');

select * from finish();
rollback;
