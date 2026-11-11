-- Etap 3 (follow-up): wizyty klienta po zamrożeniu stanu, outbox powiadomień, przywracanie stanu z rozmowy,
-- adresat powiadomień w profilu. RLS i uprawnienia nowych obiektów.
--   operator=...01  marek=...02 (owner MITAX)  ola=...03 (konsultant MITAX)  admin MITAX=...04
--   wspolnik=...05 (owner AT AI)  jan=...06 (konsultant AT AI)   MITAX=10..01  AT AI=10..02
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
grant execute on all functions in schema tests to public;

select plan(73);

-- Dane: wszystkie sesje po zamrożeniu (snapshot), poza s2 (bez snapshotu) i s5 (zarchiwizowana).
--   s1 Ola/MITAX, s2 Ola/MITAX bez snapshotu, s3 Jan/AT AI, s4 Marek/MITAX, s5 Ola zarchiwizowana,
--   s6 Ola (zmiany konsultanta), s7 Ola (wizyta zaczęta zmianą), s8 Ola (przywracanie), s9 Ola (limit prób)
insert into public.calc_sessions (id, org_id, consultant_id, token, inputs, params, revealed, status) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'tok-fu-sess001', '{"kh":100,"kpir":200,"prac":9,"przychod":2000000,"koszty":1200000}', '{}', true, 'shared'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'tok-fu-sess002', '{"kh":1}', '{}', true, 'live'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000006', 'tok-fu-sess003', '{"kh":1}', '{}', true, 'shared'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'tok-fu-sess004', '{"kh":1}', '{}', true, 'shared'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'tok-fu-sess005', '{"kh":1}', '{}', true, 'archived'),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'tok-fu-sess006', '{"kh":1}', '{}', true, 'shared'),
  ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'tok-fu-sess007', '{"kh":1}', '{}', true, 'shared'),
  ('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'tok-fu-sess008', '{"kh":100,"kpir":200,"prac":9,"przychod":2000000,"koszty":1200000}', '{}', true, 'shared'),
  ('20000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'tok-fu-sess009', '{"kh":1}', '{}', true, 'shared');

insert into public.calc_snapshots (org_id, session_id, inputs, params, result, mix, calc_version)
select s.org_id, s.id,
       case when s.id in ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000008')
            then '{"kh":100,"kpir":200,"prac":9,"przychod":2000000,"koszty":1200000}'::jsonb else '{"kh":1}'::jsonb end,
       '{}', '{}', '{"kh":10,"kpir":20}', '1.1.0'
from public.calc_sessions s
where s.id <> '20000000-0000-4000-8000-000000000002';

create function pg_temp.visits(p_token text) returns integer language sql as $$
  select count(*)::int from public.session_visits v join public.calc_sessions s on s.id = v.session_id where s.token = p_token
$$;
create function pg_temp.outbox(p_token text, p_kind text default null) returns integer language sql as $$
  select count(*)::int from public.notification_outbox o join public.calc_sessions s on s.id = o.session_id
  where s.token = p_token and (p_kind is null or o.kind = p_kind)
$$;
create function pg_temp.pings(p_token text) returns integer language sql as $$
  select count(*)::int from realtime.messages where topic = 'session:' || p_token and event = 'changed'
$$;

-- Wizyty: warunki wstępne ---------------------------------------------------------------------
select tests.login_as_service();
select is(public.record_guest_visit('tok-fu-sess002'), true, 'wizyta: sesja bez snapshotu jest znana (true)');
select is(public.record_guest_visit('tok-nie-istnieje'), false, 'wizyta: nieznany token → false');
select is(public.record_guest_visit('tok-fu-sess005'), false, 'wizyta: zarchiwizowana sesja → false');
reset role;
select is(pg_temp.visits('tok-fu-sess002') + pg_temp.outbox('tok-fu-sess002'), 0,
  'wizyta przed zamrożeniem stanu nie jest powrotem (brak wizyty i alertu)');
select is(pg_temp.visits('tok-fu-sess005'), 0, 'zarchiwizowana: brak wizyt');

-- Pierwsza wizyta po zamrożeniu ---------------------------------------------------------------
select pg_temp.pings('tok-fu-sess001') as before_pings \gset
select tests.login_as_service();
select is(public.record_guest_visit('tok-fu-sess001'), true, 'wizyta: pierwsze otwarcie po zamrożeniu');
reset role;
select is(pg_temp.visits('tok-fu-sess001'), 1, 'wizyta: powstaje jedna wizyta');
select is(pg_temp.outbox('tok-fu-sess001', 'client_returned'), 1, 'wizyta: jeden alert „klient wrócił”');
select is((select o.status from public.notification_outbox o join public.calc_sessions s on s.id = o.session_id where s.token = 'tok-fu-sess001'),
  'pending', 'alert czeka na wysyłkę (pending)');
select cmp_ok(pg_temp.pings('tok-fu-sess001'), '>', :before_pings, 'nowa wizyta wysyła ping Realtime (prezenter odświeża follow-up)');

select tests.login_as_service();
select public.record_guest_visit('tok-fu-sess001');
reset role;
select is(pg_temp.visits('tok-fu-sess001') * 10 + pg_temp.outbox('tok-fu-sess001'), 11,
  'drugie otwarcie w oknie 30 min: nadal jedna wizyta i jeden alert');

-- Zmiany klienta w trakcie wizyty -------------------------------------------------------------
select tests.login_as_service();
select public.guest_patch_calc_session('tok-fu-sess001', '{"kh":150}'::jsonb);
reset role;
select is(pg_temp.outbox('tok-fu-sess001', 'client_changed'), 1, 'zmiana klienta: jeden alert „zmienił dane”');
select is((select v.changed from public.session_visits v join public.calc_sessions s on s.id = v.session_id where s.token = 'tok-fu-sess001'),
  true, 'zmiana klienta oznacza wizytę jako „ze zmianami”');
select tests.login_as_service();
select public.guest_patch_calc_session('tok-fu-sess001', '{"kh":160,"kpir":210}'::jsonb);
select public.guest_patch_calc_session('tok-fu-sess001', '{}'::jsonb, 7);
reset role;
select is(pg_temp.outbox('tok-fu-sess001', 'client_changed'), 1, 'kolejne zmiany w tej samej wizycie nie dodają alertów');
select is(pg_temp.visits('tok-fu-sess001'), 1, 'zmiany w oknie wizyty nie tworzą nowej wizyty');

-- Zmiana konsultanta nie jest aktywnością klienta ---------------------------------------------
select tests.login_as('00000000-0000-4000-8000-000000000003');
select public.patch_calc_session_inputs('20000000-0000-4000-8000-000000000006', '{"kh":55}'::jsonb);
reset role;
select is(pg_temp.visits('tok-fu-sess006') + pg_temp.outbox('tok-fu-sess006'), 0,
  'zmiana danych przez konsultanta nie liczy się jako powrót klienta');

-- Wizyta rozpoczęta zmianą (klient miał stronę otwartą) ---------------------------------------
select tests.login_as_service();
select public.guest_patch_calc_session('tok-fu-sess007', '{"kh":2}'::jsonb);
reset role;
select is(pg_temp.visits('tok-fu-sess007'), 1, 'wizyta rozpoczęta zmianą: powstaje wizyta');
select is(pg_temp.outbox('tok-fu-sess007', 'client_returned'), 0, 'wizyta rozpoczęta zmianą: bez osobnego „wrócił”');
select is((select o.new_visit from public.notification_outbox o join public.calc_sessions s on s.id = o.session_id where s.token = 'tok-fu-sess007'),
  true, 'wizyta rozpoczęta zmianą: alert „zmienił dane” oznaczony jako nowa wizyta');

-- Okno 30 minut ---------------------------------------------------------------------------------
update public.session_visits set last_activity_at = now() - interval '29 minutes'
  where session_id = '20000000-0000-4000-8000-000000000001';
select tests.login_as_service();
select public.record_guest_visit('tok-fu-sess001');
reset role;
select is(pg_temp.visits('tok-fu-sess001'), 1, 'okno: 29 min ciszy to jeszcze ta sama wizyta');
select ok((select last_activity_at > now() - interval '1 minute' from public.session_visits
  where session_id = '20000000-0000-4000-8000-000000000001'), 'okno: aktywność przedłuża wizytę');

update public.session_visits set last_activity_at = now() - interval '31 minutes'
  where session_id = '20000000-0000-4000-8000-000000000001';
select tests.login_as_service();
select public.record_guest_visit('tok-fu-sess001');
reset role;
select is(pg_temp.visits('tok-fu-sess001'), 2, 'okno: po 31 min ciszy powstaje nowa wizyta');
select is(pg_temp.outbox('tok-fu-sess001', 'client_returned'), 2, 'okno: nowa wizyta ma własny alert „wrócił”');

select tests.login_as_service();
select public.guest_patch_calc_session('tok-fu-sess001', '{"kh":170}'::jsonb);
reset role;
select is(pg_temp.outbox('tok-fu-sess001', 'client_changed'), 2, 'nowa wizyta ma własny alert „zmienił dane” (po jednym na wizytę)');

-- Przywrócenie stanu z rozmowy ------------------------------------------------------------------
select tests.login_as_service();
select public.guest_patch_calc_session('tok-fu-sess008', '{"kh":999,"ef":70}'::jsonb, 3);
select is(public.restore_session_to_snapshot('tok-fu-sess008'), true, 'restore: wywołanie się udaje');
reset role;
select is((select inputs from public.calc_sessions where token = 'tok-fu-sess008'),
  '{"kh":100,"kpir":200,"prac":9,"przychod":2000000,"koszty":1200000}'::jsonb,
  'restore: dane wracają do snapshotu, pola dodane później znikają');
select is((select mix_kh from public.calc_sessions where token = 'tok-fu-sess008'), 10, 'restore: miks wraca do wybranego w rozmowie');
select is((select count(*)::int from public.calc_events e join public.calc_sessions s on s.id = e.session_id
  where s.token = 'tok-fu-sess008' and e.actor = 'guest' and e.field = 'kh' and e.old_value = '999' and e.new_value = '100'),
  1, 'restore: powrót jest w dzienniku jako zmiana klienta (999 → 100)');
select is((select count(*)::int from public.calc_events e join public.calc_sessions s on s.id = e.session_id
  where s.token = 'tok-fu-sess008' and e.actor = 'guest' and e.field = 'ef' and e.new_value is null), 1,
  'restore: usunięcie dodanego pola jest w dzienniku');
select is((select c.inputs from public.calc_snapshots c join public.calc_sessions s on s.id = c.session_id where s.token = 'tok-fu-sess008'),
  '{"kh":100,"kpir":200,"prac":9,"przychod":2000000,"koszty":1200000}'::jsonb, 'restore: snapshot pozostaje nietknięty');

select tests.login_as_service();
select throws_ok($$select public.restore_session_to_snapshot('tok-fu-sess002')$$, 'AT002', null, 'restore: sesja bez snapshotu → AT002');
select throws_ok($$select public.restore_session_to_snapshot('tok-nie-istnieje')$$, 'AT001', null, 'restore: nieznana sesja → AT001');
select throws_ok($$select public.restore_session_to_snapshot('tok-fu-sess005')$$, 'AT001', null, 'restore: zarchiwizowana → AT001');
reset role;

-- Uprawnienia: RPC tylko dla service_role ------------------------------------------------------
select tests.login_as('00000000-0000-4000-8000-000000000003');
select throws_ok($$select public.record_guest_visit('tok-fu-sess001')$$, '42501', null, 'RPC record_guest_visit: konsultant nie wykona');
select throws_ok($$select public.restore_session_to_snapshot('tok-fu-sess001')$$, '42501', null, 'RPC restore: konsultant nie wykona');
select throws_ok($$select public.claim_notifications()$$, '42501', null, 'RPC claim_notifications: konsultant nie wykona');
select throws_ok($$select public.finish_notification(1, 'sent')$$, '42501', null, 'RPC finish_notification: konsultant nie wykona');
reset role;
select tests.login_as_anon();
select throws_ok($$select public.record_guest_visit('tok-fu-sess001')$$, '42501', null, 'RPC record_guest_visit: anon nie wykona');
select throws_ok($$select public.restore_session_to_snapshot('tok-fu-sess001')$$, '42501', null, 'RPC restore: anon nie wykona');
reset role;

-- RLS: session_visits -----------------------------------------------------------------------------
-- (s1: 2 wizyty Oli, s7: 1 wizyta Oli, s8: 1 wizyta Oli po zmianie; s3 i s4 dostaną po jednej)
select tests.login_as_service();
select public.record_guest_visit('tok-fu-sess003');
select public.record_guest_visit('tok-fu-sess004');
reset role;

select tests.login_as('00000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.session_visits where session_id = '20000000-0000-4000-8000-000000000004'), 0,
  'RLS: konsultant nie widzi wizyt cudzej sesji (Marek, ta sama organizacja)');
select ok((select count(*)::int from public.session_visits where session_id = '20000000-0000-4000-8000-000000000001') = 2,
  'RLS: konsultant widzi wizyty własnej sesji');
select is((select count(*)::int from public.session_visits where session_id = '20000000-0000-4000-8000-000000000003'), 0,
  'RLS: konsultant nie widzi wizyt innej organizacji');
reset role;

select tests.login_as('00000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.session_visits where session_id = '20000000-0000-4000-8000-000000000004'), 1,
  'RLS: admin organizacji widzi wizyty cudzych sesji organizacji');
select is((select count(*)::int from public.session_visits where session_id = '20000000-0000-4000-8000-000000000003'), 0,
  'RLS: admin nie widzi wizyt innej organizacji');
reset role;

select tests.login_as('00000000-0000-4000-8000-000000000005');
select is((select count(*)::int from public.session_visits), 1, 'RLS: właściciel AT AI widzi tylko swoją organizację');
reset role;

select tests.login_as('00000000-0000-4000-8000-000000000001');
select is((select count(*)::int from public.session_visits), 0, 'RLS: operator platformy nie widzi wizyt');
reset role;

select tests.login_as_anon();
select throws_ok($$select count(*) from public.session_visits$$, '42501', null, 'RLS: anon nie czyta wizyt');
reset role;

select tests.login_as('00000000-0000-4000-8000-000000000003');
select throws_ok($$insert into public.session_visits (org_id, session_id) values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'wizyty: klient nie może dopisać');
select throws_ok($$update public.session_visits set changed = false$$, '42501', null, 'wizyty: klient nie może zmienić');
select throws_ok($$delete from public.session_visits$$, '42501', null, 'wizyty: klient nie może usunąć');
select throws_ok($$select count(*) from public.notification_outbox$$, '42501', null, 'outbox: konsultant nie czyta');
reset role;
select tests.login_as('00000000-0000-4000-8000-000000000004');
select throws_ok($$select count(*) from public.notification_outbox$$, '42501', null, 'outbox: admin organizacji nie czyta');
reset role;
select tests.login_as('00000000-0000-4000-8000-000000000001');
select throws_ok($$select count(*) from public.notification_outbox$$, '42501', null, 'outbox: operator nie czyta');
reset role;
select tests.login_as_anon();
select throws_ok($$select count(*) from public.notification_outbox$$, '42501', null, 'outbox: anon nie czyta');
reset role;

-- Sesji z wizytami nie da się usunąć (jak sesji z historią) ------------------------------------------------
select throws_ok($$delete from public.calc_sessions where id = '20000000-0000-4000-8000-000000000001'$$, '23503', null,
  'sesja z wizytami nie może zostać usunięta');

-- Adresat powiadomień w profilu --------------------------------------------------------------------------
select tests.login_as('00000000-0000-4000-8000-000000000003');
select lives_ok($$update public.profiles set notify_channel = 'telegram', notify_target = '-1001234567890' where user_id = '00000000-0000-4000-8000-000000000003'$$,
  'profil: właściciel ustawia adresata (Telegram)');
select throws_ok($$update public.profiles set notify_target = '12ab' where user_id = '00000000-0000-4000-8000-000000000003'$$, '23514', null,
  'profil: zły identyfikator czatu odrzucony');
select throws_ok($$update public.profiles set notify_channel = 'sms' where user_id = '00000000-0000-4000-8000-000000000003'$$, '23514', null,
  'profil: nieznany kanał odrzucony');
select throws_ok($$update public.profiles set notify_target = null where user_id = '00000000-0000-4000-8000-000000000003'$$, '23514', null,
  'profil: kanał bez adresata odrzucony (oba pola albo żadne)');
update public.profiles set notify_channel = 'telegram', notify_target = '555000111' where user_id = '00000000-0000-4000-8000-000000000002';
select is((select notify_target from public.profiles where user_id = '00000000-0000-4000-8000-000000000002'), null,
  'profil: cudzego adresata nie zmienisz (RLS)');
reset role;

-- Odbiór powiadomień ------------------------------------------------------------------------------------
select tests.login_as_service();
create temp table claimed as select jsonb_array_elements(public.claim_notifications('20000000-0000-4000-8000-000000000001', 20)) as n;
grant select on claimed to public;
reset role;
select is((select count(*)::int from claimed), 4, 'claim: odbiera wszystkie oczekujące alerty sesji (2× wrócił, 2× zmienił)');
select is((select count(*)::int from claimed where n ->> 'organization' = 'MITAX Consulting sp. z o.o.' and n ->> 'consultant_name' = 'Ola Konsultant'
  and n ->> 'notify_channel' = 'telegram' and n ->> 'notify_target' = '-1001234567890'), 4,
  'claim: alert niesie organizację, imię konsultanta i adresata z profilu');
select is((select count(*)::int from claimed, jsonb_object_keys(n) k
  where k not in ('id', 'kind', 'new_visit', 'created_at', 'session_id', 'organization', 'consultant_name', 'notify_channel', 'notify_target', 'changed_fields')),
  0, 'claim: żadnych innych pól (bez firmy, NIP-u, e-maila i wartości)');
select ok((select (n ->> 'changed_fields')::int >= 1 from claimed where n ->> 'kind' = 'client_changed' order by (n ->> 'id')::int limit 1),
  'claim: alert „zmienił dane” zawiera liczbę zmienionych pól');
select is((select attempts from public.notification_outbox where id = (select (n ->> 'id')::bigint from claimed limit 1)), 1,
  'claim: zwiększa licznik prób');
select tests.login_as_service();
select is(jsonb_array_length(public.claim_notifications('20000000-0000-4000-8000-000000000001', 20)), 0,
  'claim: przejęte wpisy nie są wydawane drugi raz (blokada 60 s)');
reset role;

-- Zamknięcie wpisu i ponowienia ---------------------------------------------------------------------------
select tests.login_as_service();
select public.finish_notification((select (n ->> 'id')::bigint from claimed where n ->> 'kind' = 'client_returned' order by (n ->> 'id')::int limit 1), 'sent');
reset role;
select is((select status from public.notification_outbox where id = (select (n ->> 'id')::bigint from claimed where n ->> 'kind' = 'client_returned' order by (n ->> 'id')::int limit 1)),
  'sent', 'finish sent: wpis oznaczony jako wysłany');
select ok((select sent_at is not null from public.notification_outbox where id = (select (n ->> 'id')::bigint from claimed where n ->> 'kind' = 'client_returned' order by (n ->> 'id')::int limit 1)),
  'finish sent: zapisany czas wysłania');

select tests.login_as_service();
select throws_ok($$select public.finish_notification(1, 'cokolwiek')$$, '22023', null, 'finish: nieznany wynik odrzucony');
reset role;

-- sesja s9: wpis ponawiany do 5 prób, potem failed
select tests.login_as_service();
select public.record_guest_visit('tok-fu-sess009');
reset role;
create function pg_temp.try_once(p_outcome text) returns void language plpgsql as $$
declare v jsonb; begin
  update public.notification_outbox set claimed_until = null where session_id = '20000000-0000-4000-8000-000000000009';
  v := public.claim_notifications('20000000-0000-4000-8000-000000000009', 5);
  if jsonb_array_length(v) = 1 then perform public.finish_notification((v -> 0 ->> 'id')::bigint, p_outcome); end if;
end $$;
select tests.login_as_service();
select pg_temp.try_once('retry');
reset role;
select is((select status || ':' || attempts from public.notification_outbox where session_id = '20000000-0000-4000-8000-000000000009'), 'pending:1',
  'ponowienie: nieudana próba zostawia wpis do ponowienia');
select tests.login_as_service();
select pg_temp.try_once('retry'); select pg_temp.try_once('retry'); select pg_temp.try_once('retry');
reset role;
select is((select status || ':' || attempts from public.notification_outbox where session_id = '20000000-0000-4000-8000-000000000009'), 'pending:4',
  'ponowienie: po 4 nieudanych próbach nadal pending');
select tests.login_as_service();
select pg_temp.try_once('retry');
reset role;
select is((select status || ':' || attempts from public.notification_outbox where session_id = '20000000-0000-4000-8000-000000000009'), 'failed:5',
  'ponowienie: po 5. nieudanej próbie wpis jest failed');
select tests.login_as_service();
select is(jsonb_array_length(public.claim_notifications('20000000-0000-4000-8000-000000000009', 5)), 0, 'ponowienie: failed nie jest już wydawany');
reset role;

select * from finish();
rollback;
