// Edge Function: dostęp rozmówcy do sesji po tokenie z linku (bez logowania).
//
// Rozmówca nie dostaje żadnego dostępu do tabel. Cały jego dostęp idzie tędy, przez service role
// po stronie serwera, a odpowiedź to widok bezpieczny dla rozmówcy (src/session/guestView.ts):
//   - bez cichych założeń (params),
//   - wynik dopiero po odsłonięciu przez konsultanta,
//   - zapis wyłącznie dozwolonych pól: dane, miks suwaka, odpowiedź.
// Obliczenia robi src/calc (ta sama implementacja co w aplikacji).
//
// POST { action: 'get', token, visit?: true }   — `visit`: klient właśnie otworzył stronę (rejestruje powrót po CTA)
// POST { action: 'patch', token, patch?: {kh, kpir, ...}, mixKh?: number, reply?: string }
// POST { action: 'restore', token }              — „Wróć do stanu z rozmowy”: dane i miks wracają do snapshotu
// → 200 { view } | 400 { error: 'bad_request' } | 404 { error: 'not_found' } | 409 { error: 'no_snapshot' }
//   | 405 | 413 | 500

import { parseGuestRequest } from '../../../src/session/guestRequest.ts';
import { buildGuestView, type SessionRow } from '../../../src/session/guestView.ts';
import { admin } from '../_shared/admin.ts';
import { loadDeliverySummary } from '../_shared/cta.ts';
import { handleNonPost, json, readJsonBody } from '../_shared/http.ts';
import { dispatchInBackground } from '../_shared/notify.ts';

// Kolumny firmy potrzebne do widoku rozmówcy (surowa odpowiedź GUS nie jest wybierana).
const COMPANY_COLUMNS =
  'nip, regon, name, street, building_no, unit_no, postal_code, city, voivodeship, gus_type, gus_status, fetched_at';

/** Widok sesji po tokenie; null, gdy sesji nie ma albo jest zarchiwizowana. */
async function loadView(token: string) {
  const { data, error } = await admin
    .from('calc_sessions')
    .select(
      `id, inputs, params, revealed, mix_kh, reply, status, company:companies(${COMPANY_COLUMNS}), organization:organizations(name, privacy_policy_url, cta_notice)`,
    )
    .eq('token', token)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status === 'archived') return null;
  // Stan CTA: leady i wysyłki (zamaskowany adres, licznik, blokada NIP-u) — bez pełnego adresu w widoku.
  const delivery = await loadDeliverySummary(data.id);
  // Stan z rozmowy (snapshot): źródło paska „Wynik z rozmowy”. Uszkodzony snapshot kończy się brakiem paska.
  const { data: snapshot, error: snapshotError } = await admin
    .from('calc_snapshots')
    .select('inputs, result, mix, calc_version, created_at')
    .eq('session_id', data.id)
    .maybeSingle();
  if (snapshotError) throw snapshotError;
  return buildGuestView({ ...(data as unknown as SessionRow), delivery, snapshot });
}

Deno.serve(async (req) => {
  const early = handleNonPost(req);
  if (early) return early;

  try {
    const body = await readJsonBody(req);
    if (!body.ok) return body.response;

    const parsed = parseGuestRequest(body.value);
    if (!parsed.ok) return json(400, { error: 'bad_request' });
    const request = parsed.request;

    if (request.action === 'get' && request.visit) {
      // Powrót klienta po zamrożeniu stanu. Rejestracja wizyty nie może zepsuć odczytu: błąd tylko logujemy.
      const { error } = await admin.rpc('record_guest_visit', { p_token: request.token });
      if (error) console.error('guest-session: record_guest_visit:', error.message);
    }

    if (request.action === 'restore') {
      const { error } = await admin.rpc('restore_session_to_snapshot', { p_token: request.token });
      if (error?.code === 'AT001') return json(404, { error: 'not_found' });
      if (error?.code === 'AT002') return json(409, { error: 'no_snapshot' });
      if (error) throw error;
    }

    if (request.action === 'patch') {
      const { data: updated, error } = await admin.rpc('guest_patch_calc_session', {
        p_token: request.token,
        p_patch: request.patch,
        p_mix_kh: request.mixKh ?? undefined,
        p_reply: request.reply ?? undefined,
      });
      if (error) throw error;
      if (!updated) return json(404, { error: 'not_found' });
    }

    const view = await loadView(request.token);
    if (!view) return json(404, { error: 'not_found' });
    // Powrót, zmiana danych i przywrócenie mogły dopisać alerty do outboxu: dostarczamy je w tle, po odpowiedzi.
    if ((request.action === 'get' && request.visit) || request.action === 'patch' || request.action === 'restore') {
      dispatchInBackground();
    }
    return json(200, { view });
  } catch (e) {
    // Szczegółów nie zwracamy rozmówcy — tylko do logów funkcji.
    console.error('guest-session:', e instanceof Error ? e.message : e);
    return json(500, { error: 'server_error' });
  }
});
