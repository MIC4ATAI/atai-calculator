-- Zliczanie użycia, RPC sesji (konsultant i rozmówca), dziennik zdarzeń, profil z triggera.
--   operator=...01  marek=...02  ola=...03 (konsultant MITAX)  admin MITAX=...04
--   wspolnik=...05 (owner AT AI)  jan=...06   MITAX=10..01  AT AI=10..02
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

select plan(43);

-- Dane: s1 (Ola/MITAX, token-s1) i s9 zarchiwizowana (Ola/MITAX, token-s9).
-- Zmiana status nie trafia do dziennika, więc calc_events startuje puste.
update public.organizations set default_params = '{"celKorzysci":15000}'
  where id = '10000000-0000-4000-8000-000000000001';
insert into public.calc_sessions (id, org_id, consultant_id, token) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'token-s1'),
  ('20000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'token-s9');
update public.calc_sessions set status = 'archived' where id = '20000000-0000-4000-8000-000000000009';

-- Zliczanie użycia -----------------------------------------------------------
select is(
  (select count(*)::int from public.calc_sessions s
    where (select count(*) from public.usage_events u where u.session_id = s.id and u.event_type = 'session_created') <> 1),
  0, 'każda sesja ma dokładnie jedno zdarzenie użycia');

select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select lives_ok($$select public.create_calc_session('10000000-0000-4000-8000-000000000001')$$, 'Ola tworzy sesję #1 przez RPC');
select lives_ok($$select public.create_calc_session('10000000-0000-4000-8000-000000000001')$$, 'Ola tworzy sesję #2 przez RPC');
reset role;

select is(
  (select count(*)::int from public.usage_events where org_id = '10000000-0000-4000-8000-000000000001'
     and consultant_id = '00000000-0000-4000-8000-000000000003'),
  4, 'zdarzenia użycia: 2 sesje z danych + 2 z RPC');
select is(
  (select count(*)::int from public.calc_sessions s
    where (select count(*) from public.usage_events u where u.session_id = s.id) <> 1),
  0, 'po RPC nadal dokładnie jedno zdarzenie użycia na sesję');

select is(
  (select params from public.calc_sessions where consultant_id = '00000000-0000-4000-8000-000000000003'
     and token not in ('token-s1', 'token-s9') limit 1),
  '{"celKorzysci":15000}'::jsonb, 'sesja z RPC dostaje kopię domyślnych założeń organizacji');
select is(
  (select count(*)::int from public.calc_sessions where token ~ '^[0-9a-f]{48}$'),
  2, 'token z RPC to 48 znaków hex (24 losowe bajty)');
select is(
  (select count(distinct token)::int from public.calc_sessions where token ~ '^[0-9a-f]{48}$'),
  2, 'tokeny są unikalne');

-- Widoczność użycia ----------------------------------------------------------
select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola (konsultant)
select is((select count(*)::int from public.usage_events), 0, 'konsultant nie widzi zdarzeń użycia');
reset role; select tests.login_as('00000000-0000-4000-8000-000000000004'); -- admin MITAX
select is((select count(*)::int from public.usage_events), 4, 'admin widzi zdarzenia użycia swojej organizacji');
reset role; select tests.login_as('00000000-0000-4000-8000-000000000005'); -- właściciel AT AI
select is((select count(*)::int from public.usage_events), 0, 'organizacje nie widzą swojego użycia nawzajem');
reset role; select tests.login_as('00000000-0000-4000-8000-000000000001'); -- operator
select is((select count(*)::int from public.usage_events), 4, 'operator widzi użycie (rozliczenia)');
select is((select count(*)::int from public.calc_sessions), 0, 'operator widzi użycie, ale nie sesje');
reset role;

-- patch_calc_session_inputs: filtrowanie i merge ----------------------------
select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select public.patch_calc_session_inputs('20000000-0000-4000-8000-000000000001',
  '{"kh":100,"evil":5,"kpir":"x","wspCzas":"","prac":[1],"ef":{"a":1}}');
select is((select inputs from public.calc_sessions where id = '20000000-0000-4000-8000-000000000001'),
  '{"kh":100,"wspCzas":""}'::jsonb, 'obce klucze i wartości niedozwolonego typu są odfiltrowane');
select public.patch_calc_session_inputs('20000000-0000-4000-8000-000000000001', '{"prac":9,"kh":120}');
select is((select inputs from public.calc_sessions where id = '20000000-0000-4000-8000-000000000001'),
  '{"kh":120,"prac":9,"wspCzas":""}'::jsonb, 'kolejna zmiana jest scalana, nie nadpisuje pozostałych pól');
select public.patch_calc_session_inputs('20000000-0000-4000-8000-000000000001', '[1,2]');
select is((select inputs from public.calc_sessions where id = '20000000-0000-4000-8000-000000000001'),
  '{"kh":120,"prac":9,"wspCzas":""}'::jsonb, 'patch niebędący obiektem niczego nie zmienia');
select throws_ok($$select public.patch_calc_session_inputs('20000000-0000-4000-8000-000000000009', '{"kh":1}')$$,
  '42501', null, 'zarchiwizowana sesja nie przyjmuje zmian od konsultanta');
select lives_ok($$update public.calc_sessions set revealed = true where id = '20000000-0000-4000-8000-000000000001'$$,
  'konsultant odsłania wynik');
reset role;

-- guest_patch_calc_session (service role) ------------------------------------
select tests.login_as_service();
select is(public.guest_patch_calc_session('token-s1', '{"przychod":2000000,"prac":8}', 5, 'Dzień dobry'), true,
  'rozmówca zapisuje dane, miks i odpowiedź');
reset role;
select is((select inputs from public.calc_sessions where id = '20000000-0000-4000-8000-000000000001'),
  '{"kh":120,"prac":8,"przychod":2000000,"wspCzas":""}'::jsonb, 'dane rozmówcy scalone z istniejącymi');
select is((select mix_kh from public.calc_sessions where id = '20000000-0000-4000-8000-000000000001'), 5, 'miks zapisany');
select is((select reply from public.calc_sessions where id = '20000000-0000-4000-8000-000000000001'), 'Dzień dobry', 'odpowiedź zapisana');

select tests.login_as_service();
select is(public.guest_patch_calc_session('token-s1', '{"koszty":1200000}'), true, 'zapis samych danych działa');
select is(public.guest_patch_calc_session('token-s1', '{"celKorzysci":1}'), true, 'próba zmiany założeń nie powoduje błędu');
select is(public.guest_patch_calc_session('token-s1', '{}', null, repeat('a', 3000)), true, 'zbyt długa odpowiedź jest przycinana');
select is(public.guest_patch_calc_session('nie-ma-takiego-tokenu', '{"kh":1}'), false, 'nieznany token: false');
select is(public.guest_patch_calc_session('token-s9', '{"kh":1}'), false, 'zarchiwizowana sesja: false');
select throws_ok($$select public.guest_patch_calc_session('token-s1', '{}', -1)$$, '23514', null,
  'ujemny miks jest odrzucony');
reset role;

select is((select mix_kh from public.calc_sessions where id = '20000000-0000-4000-8000-000000000001'), 5,
  'zapis bez miksu i odpowiedzi ich nie kasuje');
select is((select length(reply) from public.calc_sessions where id = '20000000-0000-4000-8000-000000000001'), 2000,
  'odpowiedź ma maksymalnie 2000 znaków');
select is((select params from public.calc_sessions where id = '20000000-0000-4000-8000-000000000001'), '{}'::jsonb,
  'rozmówca nie zmienia cichych założeń');
select is((select inputs ? 'celKorzysci' from public.calc_sessions where id = '20000000-0000-4000-8000-000000000001'), false,
  'klucz założeń nie trafia do danych rozmówcy');

-- Dziennik zdarzeń -----------------------------------------------------------
select is((select actor from public.calc_events where session_id = '20000000-0000-4000-8000-000000000001' and field = 'przychod'),
  'guest', 'zmianę przez rozmówcę (service role bez użytkownika) zapisano jako guest');
select is((select actor_id from public.calc_events where session_id = '20000000-0000-4000-8000-000000000001' and field = 'przychod'),
  null::uuid, 'rozmówca nie ma actor_id');
select is((select count(*)::int from public.calc_events where session_id = '20000000-0000-4000-8000-000000000001'
    and field = 'kh' and actor = 'consultant' and actor_id = '00000000-0000-4000-8000-000000000003'),
  2, 'zmiany konsultanta mają jego actor_id');
select is((select old_value from public.calc_events where field = 'kh' order by id desc limit 1), '100'::jsonb, 'dziennik: stara wartość');
select is((select new_value from public.calc_events where field = 'kh' order by id desc limit 1), '120'::jsonb, 'dziennik: nowa wartość');
select is((select new_value from public.calc_events where field = 'revealed'), 'true'::jsonb, 'odsłonięcie wyniku jest w dzienniku');

select tests.login_as('00000000-0000-4000-8000-000000000003'); -- Ola
select cmp_ok((select count(*)::int from public.calc_events), '>', 0, 'konsultant widzi dziennik własnej sesji');
reset role; select tests.login_as('00000000-0000-4000-8000-000000000006'); -- Jan (inna organizacja)
select is((select count(*)::int from public.calc_events), 0, 'konsultant innej organizacji nie widzi dziennika');
reset role;

-- Profil z triggera na auth.users ---------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000000aa', 'authenticated', 'authenticated',
        'nowy@example.test', '{"full_name":"Nowa Osoba"}');
select is((select full_name from public.profiles where user_id = '00000000-0000-4000-8000-0000000000aa'),
  'Nowa Osoba', 'nowy użytkownik Auth dostaje profil z imieniem i nazwiskiem');
select is((select count(*)::int from public.memberships where user_id = '00000000-0000-4000-8000-0000000000aa'),
  0, 'nowy użytkownik nie należy do żadnej organizacji');

-- Ping Realtime ----------------------------------------------------------------
select cmp_ok((select count(*)::int from realtime.messages where topic = 'session:token-s1' and event = 'changed'),
  '>', 0, 'zmiana sesji wysyła ping Realtime na kanał session:<token>');

select * from finish();
rollback;
