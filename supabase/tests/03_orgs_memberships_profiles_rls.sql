-- RLS: organizations, memberships, profiles, platform_operators.
-- Użytkownicy i organizacje: supabase/seed.sql.
--   operator=...01  marek=...02 (owner MITAX, konsultant AT AI)  ola=...03 (konsultant MITAX)
--   admin MITAX=...04  wspolnik=...05 (owner AT AI)  jan=...06 (konsultant AT AI)
--   MITAX=10..01  AT AI=10..02
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

select plan(42);

-- organizations: widoczność --------------------------------------------------
select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select results_eq($$select id from public.organizations order by id$$,
  $$values ('10000000-0000-4000-8000-000000000001'::uuid)$$,
  'konsultant widzi tylko swoją organizację');
reset role; select tests.login_as('00000000-0000-4000-8000-000000000002'); -- Marek
select results_eq($$select id from public.organizations order by id$$,
  $$values ('10000000-0000-4000-8000-000000000001'::uuid), ('10000000-0000-4000-8000-000000000002'::uuid)$$,
  'konto w dwóch organizacjach widzi obie');
reset role; select tests.login_as('00000000-0000-4000-8000-000000000006'); -- Jan
select results_eq($$select id from public.organizations order by id$$,
  $$values ('10000000-0000-4000-8000-000000000002'::uuid)$$,
  'organizacje się nie widzą: Jan nie widzi MITAX');
reset role; select tests.login_as('00000000-0000-4000-8000-000000000001'); -- operator
select is((select count(*)::int from public.organizations), 2, 'operator widzi wszystkie organizacje');
reset role; select tests.login_as_anon();
select throws_ok($$select count(*) from public.organizations$$, '42501', null, 'anon nie ma dostępu do organizacji');

-- organizations: zapis -------------------------------------------------------
reset role; select tests.login_as('00000000-0000-4000-8000-000000000002'); -- Marek (owner MITAX)
select results_eq(
  $$with u as (update public.organizations set brand = '{"color":"#123456"}' where id = '10000000-0000-4000-8000-000000000001' returning id) select count(*)::int from u$$,
  $$values (1)$$, 'właściciel zmienia markę swojej organizacji');
select results_eq(
  $$with u as (update public.organizations set default_params = '{"celKorzysci":15000}' where id = '10000000-0000-4000-8000-000000000001' returning id) select count(*)::int from u$$,
  $$values (1)$$, 'właściciel zmienia domyślne założenia swojej organizacji');
select throws_ok(
  $$update public.organizations set name = 'Inna nazwa' where id = '10000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'właściciel nie zmienia nazwy organizacji (tylko operator)');
select throws_ok(
  $$update public.organizations set nip = '1234567890' where id = '10000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'właściciel nie zmienia NIP organizacji (tylko operator)');
select results_eq(
  $$with u as (update public.organizations set brand = '{"color":"#000"}' where id = '10000000-0000-4000-8000-000000000002' returning id) select count(*)::int from u$$,
  $$values (0)$$, 'jako konsultant w AT AI nie zmienia jej marki');
select throws_ok(
  $$insert into public.organizations (name) values ('Nowa')$$,
  '42501', null, 'właściciel nie zakłada organizacji');
select results_eq(
  $$with d as (delete from public.organizations where id = '10000000-0000-4000-8000-000000000001' returning id) select count(*)::int from d$$,
  $$values (0)$$, 'właściciel nie usuwa organizacji');

reset role; select tests.login_as('00000000-0000-4000-8000-000000000004'); -- admin MITAX
select results_eq(
  $$with u as (update public.organizations set brand = '{"color":"#000"}' where id = '10000000-0000-4000-8000-000000000001' returning id) select count(*)::int from u$$,
  $$values (0)$$, 'admin (nie właściciel) nie zmienia marki organizacji');

reset role; select tests.login_as('00000000-0000-4000-8000-000000000001'); -- operator
select lives_ok($$update public.organizations set name = 'MITAX Consulting', nip = '1234567890' where id = '10000000-0000-4000-8000-000000000001'$$,
  'operator zmienia nazwę i NIP organizacji');
select lives_ok($$insert into public.organizations (name) values ('Trzecia organizacja')$$, 'operator zakłada organizację');
select throws_ok($$insert into public.organizations (name, nip) values ('Zły NIP', '123')$$, '23514', null,
  'NIP musi mieć 10 cyfr');

-- memberships: widoczność ----------------------------------------------------
reset role; select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select is((select count(*)::int from public.memberships), 1, 'konsultant widzi tylko własne członkostwo');
reset role; select tests.login_as('00000000-0000-4000-8000-000000000004'); -- admin MITAX
select is((select count(*)::int from public.memberships), 3, 'admin widzi członkostwa swojej organizacji');
select is((select count(*)::int from public.memberships where org_id = '10000000-0000-4000-8000-000000000002'), 0,
  'admin nie widzi członkostw innej organizacji');
reset role; select tests.login_as('00000000-0000-4000-8000-000000000002'); -- Marek
select is((select count(*)::int from public.memberships), 4,
  'Marek: 3 członkostwa MITAX (owner) + własne w AT AI (konsultant)');
reset role; select tests.login_as('00000000-0000-4000-8000-000000000001'); -- operator
select is((select count(*)::int from public.memberships), 6, 'operator widzi wszystkie członkostwa (zarządza nimi)');
reset role; select tests.login_as_anon();
select throws_ok($$select count(*) from public.memberships$$, '42501', null, 'anon nie ma dostępu do członkostw');

-- memberships: zapis ---------------------------------------------------------
reset role; select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select throws_ok(
  $$insert into public.memberships (org_id, user_id, role) values ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', 'consultant')$$,
  '42501', null, 'użytkownik nie dopisuje się sam do cudzej organizacji');
select throws_ok(
  $$insert into public.memberships (org_id, user_id, role) values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'owner')$$,
  '42501', null, 'konsultant nie nadaje sobie roli w swojej organizacji');
select results_eq(
  $$with u as (update public.memberships set role = 'owner' where user_id = '00000000-0000-4000-8000-000000000003' returning id) select count(*)::int from u$$,
  $$values (0)$$, 'konsultant nie awansuje się na właściciela');
select results_eq(
  $$with d as (delete from public.memberships where user_id = '00000000-0000-4000-8000-000000000003' returning id) select count(*)::int from d$$,
  $$values (0)$$, 'konsultant nie usuwa własnego członkostwa');

reset role; select tests.login_as('00000000-0000-4000-8000-000000000004'); -- admin MITAX
select throws_ok(
  $$insert into public.memberships (org_id, user_id, role) values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', 'consultant')$$,
  '42501', null, 'admin (nie właściciel) nie dodaje członków');

reset role; select tests.login_as('00000000-0000-4000-8000-000000000002'); -- Marek
select lives_ok(
  $$insert into public.memberships (org_id, user_id, role) values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000005', 'consultant')$$,
  'właściciel dodaje członka swojej organizacji');
select throws_ok(
  $$insert into public.memberships (org_id, user_id, role) values ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004', 'consultant')$$,
  '42501', null, 'Marek jako konsultant AT AI nie dodaje członków do AT AI');
select throws_ok(
  $$insert into public.memberships (org_id, user_id, role) values ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006', 'superadmin')$$,
  '23514', null, 'rola spoza listy jest odrzucona');
select results_eq(
  $$with u as (update public.memberships set role = 'admin' where user_id = '00000000-0000-4000-8000-000000000003' and org_id = '10000000-0000-4000-8000-000000000001' returning id) select count(*)::int from u$$,
  $$values (1)$$, 'właściciel zmienia rolę członka swojej organizacji');
select results_eq(
  $$with u as (update public.memberships set role = 'admin' where user_id = '00000000-0000-4000-8000-000000000006' returning id) select count(*)::int from u$$,
  $$values (0)$$, 'właściciel MITAX nie zmienia ról w AT AI');
select results_eq(
  $$with d as (delete from public.memberships where user_id = '00000000-0000-4000-8000-000000000005' and org_id = '10000000-0000-4000-8000-000000000001' returning id) select count(*)::int from d$$,
  $$values (1)$$, 'właściciel usuwa członka swojej organizacji');

-- profiles -------------------------------------------------------------------
reset role; select tests.login_as('00000000-0000-4000-8000-000000000006'); -- Jan (konsultant AT AI)
select is((select count(*)::int from public.profiles), 1, 'konsultant widzi tylko własny profil');
reset role; select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select results_eq(
  $$with u as (update public.profiles set full_name = 'Ola K.', phone = '+48 600 000 000' where user_id = '00000000-0000-4000-8000-000000000003' returning user_id) select count(*)::int from u$$,
  $$values (1)$$, 'osoba edytuje własny profil');
select results_eq(
  $$with u as (update public.profiles set full_name = 'Hack' where user_id = '00000000-0000-4000-8000-000000000002' returning user_id) select count(*)::int from u$$,
  $$values (0)$$, 'osoba nie edytuje cudzego profilu');
reset role; select tests.login_as('00000000-0000-4000-8000-000000000004'); -- admin MITAX
select is((select count(*)::int from public.profiles where user_id in (
    '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004')),
  3, 'admin widzi profile członków swojej organizacji');
select is((select count(*)::int from public.profiles where user_id in (
    '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006')),
  0, 'admin nie widzi profili osób z innej organizacji');
select results_eq(
  $$with u as (update public.profiles set full_name = 'Hack' where user_id = '00000000-0000-4000-8000-000000000003' returning user_id) select count(*)::int from u$$,
  $$values (0)$$, 'admin nie edytuje cudzego profilu');

-- platform_operators ---------------------------------------------------------
reset role; select tests.login_as('00000000-0000-4000-8000-000000000001'); -- operator
select is((select count(*)::int from public.platform_operators), 1, 'operator widzi własny wiersz');
reset role; select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select is((select count(*)::int from public.platform_operators), 0, 'zwykły użytkownik nie widzi listy operatorów');
select throws_ok(
  $$insert into public.platform_operators (user_id) values ('00000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'użytkownik nie nadaje sobie roli operatora');

select * from finish();
rollback;
