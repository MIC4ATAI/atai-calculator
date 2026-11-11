-- Klauzula informacyjna RODO przy CTA: kolumna organizations.cta_notice i ograniczenie linku do polityki prywatności.
--   marek=...02 (owner MITAX)  ola=...03 (konsultant MITAX)  wspolnik=...05 (owner AT AI)  operator=...01
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
grant execute on all functions in schema tests to public;

select plan(11);

select has_column('public', 'organizations', 'cta_notice', 'organizations ma kolumnę cta_notice');

-- Właściciel organizacji edytuje klauzulę i link
select tests.login_as('00000000-0000-4000-8000-000000000002');
select lives_ok(
  $$update public.organizations set cta_notice = 'Administratorem danych jest MITAX. Adres e-mail wykorzystamy do wysyłki.' where id = '10000000-0000-4000-8000-000000000001'$$,
  'właściciel ustawia treść klauzuli');
select lives_ok(
  $$update public.organizations set privacy_policy_url = 'https://mitax.pl/polityka-prywatnosci' where id = '10000000-0000-4000-8000-000000000001'$$,
  'właściciel ustawia link do polityki prywatności (https)');
select is((select cta_notice from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
  'Administratorem danych jest MITAX. Adres e-mail wykorzystamy do wysyłki.', 'treść klauzuli zapisana');

-- Ograniczenia danych
select throws_ok($$update public.organizations set cta_notice = 'za krótkie' where id = '10000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'treść krótsza niż 20 znaków odrzucona');
select throws_ok($$update public.organizations set cta_notice = repeat('a', 1501) where id = '10000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'treść dłuższa niż 1500 znaków odrzucona');
select throws_ok($$update public.organizations set privacy_policy_url = 'javascript:alert(1)' where id = '10000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'link javascript: odrzucony');
select throws_ok($$update public.organizations set privacy_policy_url = 'http://mitax.pl/polityka' where id = '10000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'link http (bez https) odrzucony');
select throws_ok($$update public.organizations set privacy_policy_url = 'https://mitax.pl/a b' where id = '10000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'link z białym znakiem odrzucony');
reset role;

-- Konsultant nie zmienia klauzuli organizacji (polityka UPDATE: tylko właściciel i operator)
select tests.login_as('00000000-0000-4000-8000-000000000003');
update public.organizations set cta_notice = 'Konsultant próbuje zmienić treść klauzuli organizacji.' where id = '10000000-0000-4000-8000-000000000001';
reset role;
select isnt((select cta_notice from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
  'Konsultant próbuje zmienić treść klauzuli organizacji.', 'konsultant nie zmienia klauzuli (RLS)');

-- Właściciel innej organizacji nie zmienia klauzuli cudzej organizacji
select tests.login_as('00000000-0000-4000-8000-000000000005');
update public.organizations set cta_notice = 'Właściciel AT AI próbuje zmienić klauzulę MITAX przy CTA.' where id = '10000000-0000-4000-8000-000000000001';
reset role;
select isnt((select cta_notice from public.organizations where id = '10000000-0000-4000-8000-000000000001'),
  'Właściciel AT AI próbuje zmienić klauzulę MITAX przy CTA.', 'właściciel innej organizacji nie zmienia klauzuli (RLS)');

select * from finish();
rollback;
