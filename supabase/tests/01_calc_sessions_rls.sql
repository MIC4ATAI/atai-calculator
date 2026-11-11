-- RLS: calc_sessions — konsultant widzi swoje, właściciel/admin całą organizację,
-- organizacje się nie widzą, operator i niezalogowani nie mają dostępu.
-- Użytkownicy i organizacje: supabase/seed.sql.
--   operator=...01  marek=...02 (owner MITAX, konsultant AT AI)  ola=...03 (konsultant MITAX)
--   admin MITAX=...04  wspolnik=...05 (owner AT AI)  jan=...06 (konsultant AT AI)
begin;
create extension if not exists pgtap with schema extensions;

create schema tests;
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

select plan(31);

-- Dane: 4 sesje (s1 Ola/MITAX, s2 Marek/MITAX, s3 Jan/AT AI, s4 Marek/AT AI).
insert into public.calc_sessions (id, org_id, consultant_id) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000006'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002');
-- Zdarzenie w dzienniku i snapshot, żeby sprawdzić, że operator ich nie widzi.
update public.calc_sessions set revealed = true where id = '20000000-0000-4000-8000-000000000001';
insert into public.calc_snapshots (org_id, session_id, inputs, params, result, mix, calc_version)
values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '{}', '{}', '{}', '{}', '1.0.0');

-- Konsultant widzi tylko swoje sesje ---------------------------------------
select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select results_eq(
  $$select id from public.calc_sessions order by id$$,
  $$values ('20000000-0000-4000-8000-000000000001'::uuid)$$,
  'konsultant (Ola) widzi tylko własną sesję, nie sesję właściciela z tej samej organizacji');

reset role; select tests.login_as('00000000-0000-4000-8000-000000000006'); -- Jan
select results_eq(
  $$select id from public.calc_sessions order by id$$,
  $$values ('20000000-0000-4000-8000-000000000003'::uuid)$$,
  'konsultant (Jan) widzi tylko własną sesję');

-- Właściciel / admin widzi całą organizację ---------------------------------
reset role; select tests.login_as('00000000-0000-4000-8000-000000000004'); -- admin MITAX
select results_eq(
  $$select id from public.calc_sessions order by id$$,
  $$values ('20000000-0000-4000-8000-000000000001'::uuid), ('20000000-0000-4000-8000-000000000002'::uuid)$$,
  'admin MITAX widzi wszystkie sesje MITAX i żadnej z AT AI');

reset role; select tests.login_as('00000000-0000-4000-8000-000000000005'); -- właściciel AT AI
select results_eq(
  $$select id from public.calc_sessions order by id$$,
  $$values ('20000000-0000-4000-8000-000000000003'::uuid), ('20000000-0000-4000-8000-000000000004'::uuid)$$,
  'właściciel AT AI widzi wszystkie sesje AT AI i żadnej z MITAX');

-- Jedno konto, dwie organizacje: rola zależy od organizacji ------------------
reset role; select tests.login_as('00000000-0000-4000-8000-000000000002'); -- Marek
select results_eq(
  $$select id from public.calc_sessions order by id$$,
  $$values ('20000000-0000-4000-8000-000000000001'::uuid),
           ('20000000-0000-4000-8000-000000000002'::uuid),
           ('20000000-0000-4000-8000-000000000004'::uuid)$$,
  'Marek: w MITAX (owner) widzi całą organizację, w AT AI (konsultant) tylko własną sesję');

-- Operator i niezalogowani --------------------------------------------------
reset role; select tests.login_as('00000000-0000-4000-8000-000000000001'); -- operator
select is((select count(*)::int from public.calc_sessions), 0, 'operator nie widzi żadnej sesji');
select is((select count(*)::int from public.calc_events), 0, 'operator nie widzi dziennika zdarzeń');
select is((select count(*)::int from public.calc_snapshots), 0, 'operator nie widzi snapshotów');

reset role; select tests.login_as_anon();
select throws_ok($$select count(*) from public.calc_sessions$$, '42501', null,
  'niezalogowany (anon) nie ma dostępu do calc_sessions');
select throws_ok($$select count(*) from public.calc_events$$, '42501', null,
  'niezalogowany (anon) nie ma dostępu do calc_events');
select throws_ok($$select count(*) from public.calc_snapshots$$, '42501', null,
  'niezalogowany (anon) nie ma dostępu do calc_snapshots');

-- Zapis: brak INSERT, UPDATE tylko własnej sesji i tylko wybranych kolumn ---
reset role; select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select throws_ok(
  $$insert into public.calc_sessions (org_id, consultant_id) values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'konsultant nie wstawia sesji bezpośrednio (tylko przez create_calc_session)');

select results_eq(
  $$with u as (update public.calc_sessions set revealed = false where id = '20000000-0000-4000-8000-000000000001' returning id)
    select count(*)::int from u$$,
  $$values (1)$$, 'konsultant zmienia własną sesję');
select results_eq(
  $$with u as (update public.calc_sessions set revealed = true where id = '20000000-0000-4000-8000-000000000002' returning id)
    select count(*)::int from u$$,
  $$values (0)$$, 'konsultant nie zmienia cudzej sesji z tej samej organizacji');
select results_eq(
  $$with u as (update public.calc_sessions set revealed = true where id = '20000000-0000-4000-8000-000000000003' returning id)
    select count(*)::int from u$$,
  $$values (0)$$, 'konsultant nie zmienia sesji z innej organizacji');
select throws_ok(
  $$update public.calc_sessions set consultant_id = '00000000-0000-4000-8000-000000000002' where id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'konsultant nie przepisuje sesji na kogoś innego (brak grantu na consultant_id)');
select throws_ok(
  $$update public.calc_sessions set org_id = '10000000-0000-4000-8000-000000000002' where id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'konsultant nie przenosi sesji do innej organizacji (brak grantu na org_id)');
select throws_ok(
  $$update public.calc_sessions set token = 'x' where id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'konsultant nie zmienia tokenu');
select throws_ok(
  $$update public.calc_sessions set inputs = '{"kh":1}' where id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'inputs zmienia się tylko przez RPC (brak grantu na inputs)');
select throws_ok(
  $$delete from public.calc_sessions where id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'konsultant nie usuwa sesji');

reset role; select tests.login_as('00000000-0000-4000-8000-000000000004'); -- admin MITAX
select results_eq(
  $$with u as (update public.calc_sessions set revealed = true where id = '20000000-0000-4000-8000-000000000001' returning id)
    select count(*)::int from u$$,
  $$values (0)$$, 'admin widzi sesje organizacji, ale nie edytuje cudzych');

-- RPC -----------------------------------------------------------------------
reset role; select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select throws_ok(
  $$select public.create_calc_session('10000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'create_calc_session: nie-członek organizacji dostaje odmowę');
select lives_ok(
  $$select public.create_calc_session('10000000-0000-4000-8000-000000000001')$$,
  'create_calc_session: członek organizacji tworzy sesję');
select is(
  (select count(*)::int from public.calc_sessions where consultant_id = '00000000-0000-4000-8000-000000000003'),
  2, 'nowa sesja jest widoczna dla jej konsultanta');

select throws_ok(
  $$select public.patch_calc_session_inputs('20000000-0000-4000-8000-000000000002', '{"kh":1}')$$,
  '42501', null, 'patch_calc_session_inputs: cudza sesja z tej samej organizacji — odmowa');
select throws_ok(
  $$select public.patch_calc_session_inputs('20000000-0000-4000-8000-000000000003', '{"kh":1}')$$,
  '42501', null, 'patch_calc_session_inputs: sesja z innej organizacji — odmowa');
select lives_ok(
  $$select public.patch_calc_session_inputs('20000000-0000-4000-8000-000000000001', '{"kh":1}')$$,
  'patch_calc_session_inputs: własna sesja działa');

reset role; select tests.login_as('00000000-0000-4000-8000-000000000004'); -- admin
select throws_ok(
  $$select public.patch_calc_session_inputs('20000000-0000-4000-8000-000000000001', '{"kh":2}')$$,
  '42501', null, 'patch_calc_session_inputs: admin nie zmienia danych cudzej sesji');

reset role; select tests.login_as('00000000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.guest_patch_calc_session('x', '{"kh":1}')$$,
  '42501', null, 'guest_patch_calc_session: niedostępne dla zalogowanego konsultanta');

reset role; select tests.login_as_anon();
select throws_ok(
  $$select public.create_calc_session('10000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'create_calc_session: niedostępne dla anon');
select throws_ok(
  $$select public.guest_patch_calc_session('x', '{"kh":1}')$$,
  '42501', null, 'guest_patch_calc_session: niedostępne dla anon');

select * from finish();
rollback;
