-- Lead i próby dostawy odświeżają sesję przez Realtime (ping na kanale session:<token>),
-- a dane osobowe (e-mail) nie trafiają do kanału ani do publikacji.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- Dane: sesja z firmą, snapshot (jak po zamrożeniu).
insert into public.companies (id, org_id, nip, name, gus_status)
  values ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '5261040567', 'FIRMA', 'found');
insert into public.calc_sessions (id, org_id, consultant_id, token, revealed, company_id) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003',
   'tok-touch-0001', true, '40000000-0000-4000-8000-000000000001');
insert into public.calc_snapshots (id, org_id, session_id, inputs, params, result, mix, calc_version)
  values ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
          '20000000-0000-4000-8000-000000000001', '{}', '{}', '{}', '{}', '1.1.0');

create function pg_temp.pings() returns integer language sql as $$
  select count(*)::int from realtime.messages where topic = 'session:tok-touch-0001' and event = 'changed'
$$;

select is(pg_temp.pings(), 0, 'start: sesja jeszcze nie wysłała żadnego pinga');

insert into public.leads (id, org_id, session_id, consultant_id, company_id, snapshot_id, email)
  values ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000001', 'rozmowca@firma.pl');
select is(pg_temp.pings(), 1, 'utworzenie leada wysyła ping (inne karty dowiedzą się o zablokowanym NIP-ie)');

insert into public.lead_deliveries (org_id, lead_id, status, provider, error)
  values ('10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'failed', 'mailpit', 'timeout');
select is(pg_temp.pings(), 2, 'nieudana dostawa wysyła ping (prezenter zobaczy nieudaną próbę)');
select is((select status from public.calc_sessions where token = 'tok-touch-0001'), 'live',
  'nieudana dostawa nie zmienia statusu sesji');
select is((select count(*)::int from public.usage_events where event_type = 'calculation_sent'), 0,
  'nieudana dostawa nie liczy się do użycia');

insert into public.lead_deliveries (org_id, lead_id, status, provider, provider_message_id)
  values ('10000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'sent', 'mailpit', 'm-1');
select cmp_ok(pg_temp.pings(), '>=', 3, 'udana dostawa wysyła ping');
select is((select status from public.calc_sessions where token = 'tok-touch-0001'), 'shared',
  'udana dostawa: sesja „udostępniona”');
select is((select count(*)::int from public.usage_events where event_type = 'calculation_sent'), 1,
  'udana dostawa: jedno zdarzenie użycia');

-- Dane osobowe nie przechodzą kanałem: payload pingu jest pusty
select is((select count(*)::int from realtime.messages where topic = 'session:tok-touch-0001' and payload::text like '%firma.pl%'), 0,
  'payload pingów nie zawiera adresu e-mail');

select * from finish();
rollback;
