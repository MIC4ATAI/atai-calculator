-- Ponawianie zaległych powiadomień niezależnie od ruchu klienta: co minutę pg_cron sprawdza outbox i, gdy coś czeka,
-- wywołuje funkcję `dispatch-notifications` przez pg_net.
--
-- Adres funkcji i sekret NIE są w migracji (są różne w każdym środowisku): czytamy je z Vault przy każdym uruchomieniu.
-- Ustawia się je raz na środowisko (patrz docs/deploy.md); bez nich zadanie nic nie robi.
--   vault secret `dispatch_url`    — pełny adres funkcji, np. https://<ref>.supabase.co/functions/v1/dispatch-notifications
--   vault secret `dispatch_secret` — ten sam sekret co DISPATCH_SECRET w środowisku funkcji

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
-- Vault przechowuje adres i sekret wywołania (czytane przy każdym uruchomieniu zadania); idempotentne, jeśli już włączony.
create extension if not exists supabase_vault with schema vault;

create function private.dispatch_notifications_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'dispatch_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'dispatch_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return; -- środowisko bez skonfigurowanej wysyłki
  end if;

  -- Bez zaległych wpisów nie ma po co wywoływać funkcji (oszczędza wywołania co minutę).
  if not exists (
    select 1 from public.notification_outbox o
    where o.status = 'pending' and o.attempts < 5 and (o.claimed_until is null or o.claimed_until < now())
  ) then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Dispatch-Secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
end $$;

revoke execute on function private.dispatch_notifications_tick() from public, anon, authenticated;

-- Nazwane zadanie: ponowne uruchomienie migracji nie tworzy duplikatu (cron.schedule z tą samą nazwą aktualizuje zadanie).
select cron.schedule('dispatch-notifications', '* * * * *', $cron$select private.dispatch_notifications_tick()$cron$);
