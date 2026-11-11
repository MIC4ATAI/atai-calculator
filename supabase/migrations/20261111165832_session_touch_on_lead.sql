-- Utworzenie leada i każda próba dostawy (także nieudana) „dotykają” sesji: UPDATE calc_sessions uruchamia ping
-- Realtime (kanał session:<token>) i zmianę postgres_changes, więc prezenter i inne karty rozmówcy odświeżają stan
-- (zablokowany NIP, „Kalkulacja wysłana”, nieudana próba). Same tabele leads i lead_deliveries nie są w publikacji
-- Realtime — celowo: dane osobowe (adres e-mail) nie przechodzą kanałem, tylko sygnał „coś się zmieniło”.

create function private.touch_session(p_session_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.calc_sessions set updated_at = now() where id = p_session_id;
$$;

create function private.lead_touches_session() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.touch_session(new.session_id);
  return null;
end $$;

create trigger leads_touch_session
  after insert on public.leads
  for each row execute function private.lead_touches_session();

-- Dostawa: udana = zdarzenie użycia + status „udostępniona” (jak dotąd); każda próba dodatkowo dotyka sesji.
create or replace function private.record_delivery_effects() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads;
begin
  select * into v_lead from public.leads where id = new.lead_id;
  if new.status = 'sent' then
    insert into public.usage_events (org_id, session_id, consultant_id, event_type)
    values (v_lead.org_id, v_lead.session_id, v_lead.consultant_id, 'calculation_sent');
    update public.calc_sessions set status = 'shared' where id = v_lead.session_id and status = 'live';
  end if;
  perform private.touch_session(v_lead.session_id);
  return null;
end $$;

revoke execute on all functions in schema private from public, anon;
