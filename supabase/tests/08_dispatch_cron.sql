-- Cron powiadomień: zadanie pg_cron i funkcja `private.dispatch_notifications_tick()` (Vault + pg_net).
-- Test działa w transakcji (rollback), więc sekrety Vault i żądania w kolejce pg_net nie zostają.
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
grant execute on all functions in schema tests to public;

select plan(13);

create function pg_temp.queued() returns integer language sql as $$ select count(*)::int from net.http_request_queue $$;

-- Zadanie ---------------------------------------------------------------------------------------
select is((select count(*)::int from cron.job where jobname = 'dispatch-notifications'), 1, 'cron: jest jedno zadanie dispatch-notifications');
select is((select schedule from cron.job where jobname = 'dispatch-notifications'), '* * * * *', 'cron: uruchamiane co minutę');
select is((select command from cron.job where jobname = 'dispatch-notifications'), 'select private.dispatch_notifications_tick()',
  'cron: zadanie woła funkcję tick');

-- Uprawnienia -----------------------------------------------------------------------------------
select tests.login_as('00000000-0000-4000-8000-000000000003');
select throws_ok($$select private.dispatch_notifications_tick()$$, '42501', null, 'tick: konsultant nie wywoła');
reset role;
select tests.login_as_anon();
select throws_ok($$select private.dispatch_notifications_tick()$$, '42501', null, 'tick: anon nie wywoła');
reset role;

-- Dane: sesja po zamrożeniu i jeden zaległy alert -----------------------------------------------------
insert into public.calc_sessions (id, org_id, consultant_id, token, revealed, status) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'tok-cron-sess01', true, 'shared');
insert into public.calc_snapshots (org_id, session_id, inputs, params, result, mix, calc_version)
  values ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '{}', '{}', '{}', '{}', '1.1.0');

-- Bez sekretów w Vault nic nie robimy (środowisko bez skonfigurowanej wysyłki) ------------------------------
select public.record_guest_visit('tok-cron-sess01');
select is((select count(*)::int from public.notification_outbox where status = 'pending'), 1, 'start: jeden zaległy alert');
select pg_temp.queued() as before_q \gset
select private.dispatch_notifications_tick();
select is(pg_temp.queued(), :before_q, 'tick bez sekretów w Vault: brak wywołania HTTP');

-- Sekret bez adresu (połowiczna konfiguracja) też nic nie robi
select vault.create_secret(repeat('s', 40) || '-test', 'dispatch_secret');
select private.dispatch_notifications_tick();
select is(pg_temp.queued(), :before_q, 'tick z samym sekretem (bez adresu): brak wywołania HTTP');

-- Pełna konfiguracja i zaległy alert: jedno żądanie z sekretem w nagłówku -----------------------------------
select vault.create_secret('http://localhost:9/functions/v1/dispatch-notifications', 'dispatch_url');
select private.dispatch_notifications_tick();
select is(pg_temp.queued(), :before_q + 1, 'tick z konfiguracją i zaległym alertem: jedno żądanie HTTP');
select is((select url from net.http_request_queue order by id desc limit 1), 'http://localhost:9/functions/v1/dispatch-notifications',
  'żądanie trafia pod adres z Vault');
select ok((select headers ? 'X-Dispatch-Secret' and headers ->> 'X-Dispatch-Secret' = repeat('s', 40) || '-test'
  from net.http_request_queue order by id desc limit 1), 'żądanie niesie sekret w nagłówku X-Dispatch-Secret');

-- Bez zaległych wpisów nie wywołujemy funkcji (oszczędność wywołań co minutę) ---------------------------------
update public.notification_outbox set status = 'sent', sent_at = now();
select pg_temp.queued() as after_q \gset
select private.dispatch_notifications_tick();
select is(pg_temp.queued(), :after_q, 'tick bez zaległych wpisów: brak wywołania HTTP');

-- Wpis po 5 próbach (failed) albo przejęty przez inną instancję nie liczy się jako zaległy
update public.notification_outbox set status = 'pending', attempts = 5, sent_at = null;
select private.dispatch_notifications_tick();
select is(pg_temp.queued(), :after_q, 'tick: wpis z wyczerpanymi próbami nie wywołuje funkcji');

select * from finish();
rollback;
