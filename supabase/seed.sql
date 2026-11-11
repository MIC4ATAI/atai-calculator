-- Dane deweloperskie i testowe (lokalnie). NIGDY nie uruchamiane na produkcji.
-- Stałe UUID — testy pgTAP (supabase/tests) polegają na tych identyfikatorach.
--
-- Użytkownicy (logowanie magic linkiem lokalnie: Inbucket http://127.0.0.1:54324):
--   operator@platform.test   operator platformy (bez członkostwa w organizacjach)
--   marek@mitax.test         właściciel MITAX, konsultant w AT AI (jedno konto, dwie organizacje)
--   ola@mitax.test           konsultant MITAX
--   admin@mitax.test         admin MITAX
--   wspolnik@atai.test       właściciel AT AI
--   jan@atai.test            konsultant AT AI

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name),
  now(), now(),
  '', '', '', '', '', '', '', ''
from (values
  ('00000000-0000-4000-8000-000000000001'::uuid, 'operator@platform.test', 'Operator Platformy'),
  ('00000000-0000-4000-8000-000000000002'::uuid, 'marek@mitax.test',       'Marek Kustosz'),
  ('00000000-0000-4000-8000-000000000003'::uuid, 'ola@mitax.test',         'Ola Konsultant'),
  ('00000000-0000-4000-8000-000000000004'::uuid, 'admin@mitax.test',       'Adam Admin'),
  ('00000000-0000-4000-8000-000000000005'::uuid, 'wspolnik@atai.test',     'Wiktor Wspólnik'),
  ('00000000-0000-4000-8000-000000000006'::uuid, 'jan@atai.test',          'Jan Konsultant')
) as u (id, email, full_name);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users u
where u.email like '%.test';

insert into public.organizations (id, name) values
  ('10000000-0000-4000-8000-000000000001', 'MITAX Consulting sp. z o.o.'),
  ('10000000-0000-4000-8000-000000000002', 'AT AI Solutions');

insert into public.memberships (org_id, user_id, role) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'owner'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'consultant'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000004', 'admin'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000005', 'owner'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000006', 'consultant'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'consultant');

insert into public.platform_operators (user_id) values ('00000000-0000-4000-8000-000000000001');
