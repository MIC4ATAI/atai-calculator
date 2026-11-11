// Edge Function: CTA „Przyślij mi kalkulację jako Excel oraz link do sesji” (bez logowania, po tokenie z linku).
//
// Przebieg: polityka CTA → zamrożenie stanu i zapis leada (RPC prepare_calculation_delivery, atomowo) →
// Excel i mail ZE SNAPSHOTU → wysyłka (MailerSend, lokalnie Mailpit) → zapis dostawy (lead_deliveries).
// Rozmówca nie ma dostępu do żadnej tabeli; funkcja zwraca tylko stan CTA (bez pełnego adresu e-mail).
//
// POST { token, email? }     email pominięty = ponowna wysyłka na adres zablokowany po pierwszej udanej
// → 200 { cta }              wysłano (cta: stan po wysyłce; `duplicate: true` = podwójne kliknięcie, nic nie wysłano)
// → 400 { error: 'bad_request' | 'invalid_email', cta? }
// → 404 { error: 'not_found' }
// → 409 { error: 'not_revealed' | 'no_company' | 'incomplete_data' | 'email_locked' | 'state_changed', cta? }
// → 429 { error: 'limit_reached', cta }
// → 502 { error: 'send_failed', retryable, cta }   dostawca poczty odrzucił lub nie odpowiedział
// → 405 | 413 | 500

import { parseCalculationRequest } from '../../../src/cta/calculationRequest.ts';
import {
  buildCalcPayload,
  buildDeliveryMessage,
  ctaStateFrom,
  isDuplicateSend,
  type SnapshotRow,
} from '../../../src/cta/calculationJob.ts';
import { buildCtaView, ctaRejectionStatus, decideCta } from '../../../src/cta/ctaPolicy.ts';
import { createMailer, readDefaultSender } from '../../../src/email/mailer.ts';
import { admin } from '../_shared/admin.ts';
import { loadDeliverySummary } from '../_shared/cta.ts';
import { handleNonPost, json, readJsonBody } from '../_shared/http.ts';

const SESSION_COLUMNS = 'id, org_id, consultant_id, inputs, params, revealed, mix_kh, status, company_id, updated_at';

type SessionRow = {
  id: string;
  org_id: string;
  consultant_id: string;
  inputs: unknown;
  params: unknown;
  revealed: boolean;
  mix_kh: number | null;
  status: string;
  company_id: string | null;
  updated_at: string;
};

async function loadSession(token: string): Promise<SessionRow | null> {
  const { data, error } = await admin.from('calc_sessions').select(SESSION_COLUMNS).eq('token', token).maybeSingle();
  if (error) throw error;
  if (!data || data.status === 'archived') return null;
  return data as SessionRow;
}

/** Kody błędów RPC prepare_calculation_delivery (SQLSTATE) → odpowiedzi HTTP. */
function rpcErrorResponse(code: string): { status: number; error: string } | null {
  switch (code) {
    case 'AT001':
      return { status: 404, error: 'not_found' };
    case 'AT002':
      return { status: 409, error: 'email_locked' };
    case 'AT003':
      return { status: 429, error: 'limit_reached' };
    case 'AT005':
      return { status: 409, error: 'incomplete_data' };
    case '23514':
      return { status: 400, error: 'invalid_email' }; // adres odrzucony przez ograniczenie w bazie
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  const early = handleNonPost(req);
  if (early) return early;

  try {
    const body = await readJsonBody(req);
    if (!body.ok) return body.response;
    const parsed = parseCalculationRequest(body.value);
    if (!parsed.ok) return json(400, { error: 'bad_request' });
    const { token } = parsed;

    // Konfiguracja poczty sprawdzana NA POCZĄTKU: błąd konfiguracji nie może zostawić po sobie snapshotu ani leada.
    const env = (name: string) => Deno.env.get(name);
    const mailer = createMailer(env);
    const defaultSender = readDefaultSender(env);
    const appBaseUrl = env('APP_BASE_URL')?.trim();
    if (!appBaseUrl) throw new Error('Brak APP_BASE_URL');

    const session = await loadSession(token);
    if (!session) return json(404, { error: 'not_found' });

    // 1. Polityka CTA (tanie odrzucenia przed jakąkolwiek kosztowną pracą).
    const delivery = await loadDeliverySummary(session.id);
    const state = ctaStateFrom({
      revealed: session.revealed,
      inputs: session.inputs,
      params: session.params,
      hasCompany: session.company_id !== null,
      delivery,
    });
    const decision = decideCta(state, parsed.email ?? delivery.lockedEmail);
    if (!decision.ok) {
      return json(ctaRejectionStatus(decision.reason), { error: decision.reason, cta: buildCtaView(state) });
    }
    // Podwójne kliknięcie „Wyślij ponownie”: nie wysyłamy drugiego maila tuż po pierwszym.
    if (decision.kind === 'resend' && isDuplicateSend(delivery.lastSentAt, Date.now())) {
      return json(200, { cta: buildCtaView(state), duplicate: true });
    }

    // 2. Zamrożenie stanu i lead (atomowo w bazie). Zmiana stanu w trakcie (AT004) → jedno ponowienie.
    let current = session;
    let prepared: { snapshot: SnapshotRow; lead_id: string } | null = null;
    for (let attempt = 0; attempt < 2 && !prepared; attempt += 1) {
      const payload = buildCalcPayload(current);
      if (!payload) return json(409, { error: 'incomplete_data', cta: buildCtaView(state) });

      const { data, error } = await admin.rpc('prepare_calculation_delivery', {
        p_token: token,
        p_email: decision.email,
        p_calc: payload as never,
        p_expected_updated_at: current.updated_at,
      });
      if (!error) {
        prepared = data as unknown as { snapshot: SnapshotRow; lead_id: string };
        break;
      }
      if (error.code === 'AT004' && attempt === 0) {
        const fresh = await loadSession(token);
        if (!fresh) return json(404, { error: 'not_found' });
        current = fresh;
        continue;
      }
      if (error.code === 'AT004') return json(409, { error: 'state_changed', cta: buildCtaView(state) });
      const mapped = rpcErrorResponse(error.code);
      if (mapped) return json(mapped.status, { error: mapped.error, cta: buildCtaView(state) });
      throw error;
    }
    if (!prepared) throw new Error('Brak wyniku prepare_calculation_delivery');

    // 3. Dane do maila: organizacja, firma, konsultant (profil + adres do Reply-To) — wszystko ze snapshotu i bazy.
    const [orgRes, companyRes, profileRes, userRes] = await Promise.all([
      admin.from('organizations').select('name, brand').eq('id', session.org_id).single(),
      admin.from('companies').select('name, nip').eq('id', session.company_id as string).single(),
      admin.from('profiles').select('full_name, phone, signature').eq('user_id', session.consultant_id).maybeSingle(),
      admin.auth.admin.getUserById(session.consultant_id),
    ]);
    if (orgRes.error) throw orgRes.error;
    if (companyRes.error) throw companyRes.error;
    if (profileRes.error) throw profileRes.error;

    const message = await buildDeliveryMessage({
      snapshot: prepared.snapshot,
      org: { name: orgRes.data.name, brand: orgRes.data.brand },
      company: { name: companyRes.data.name, nip: companyRes.data.nip },
      consultant: {
        name: profileRes.data?.full_name ?? null,
        phone: profileRes.data?.phone ?? null,
        signature: profileRes.data?.signature ?? null,
        email: userRes.data.user?.email ?? null,
      },
      token,
      appBaseUrl,
      recipient: decision.email,
      defaultSender,
    });

    // 4. Wysyłka i zapis dostawy (udana: użycie + status „udostępniona” robi trigger w bazie).
    const result = await mailer.send(message);
    const record = {
      org_id: session.org_id,
      lead_id: prepared.lead_id,
      status: result.ok ? 'sent' : 'failed',
      provider: mailer.provider,
      provider_message_id: result.ok ? result.id : null,
      error: result.ok ? null : result.error,
    };
    let recorded = await admin.from('lead_deliveries').insert(record);
    if (recorded.error) recorded = await admin.from('lead_deliveries').insert(record); // jedno ponowienie
    if (recorded.error) {
      // Mail mógł wyjść, a nie mamy śladu — to ważne dla limitu wysyłek, więc głośno do logów (bez danych osobowych).
      console.error('request-calculation: nie zapisano dostawy:', recorded.error.message, 'wysłano:', result.ok);
    }

    const after = ctaStateFrom({
      revealed: session.revealed,
      inputs: session.inputs,
      params: session.params,
      hasCompany: true,
      delivery: await loadDeliverySummary(session.id),
    });
    if (!result.ok) {
      return json(502, { error: 'send_failed', retryable: result.retryable, cta: buildCtaView(after) });
    }
    return json(200, { cta: buildCtaView(after) });
  } catch (e) {
    // Szczegółów (w tym adresu rozmówcy) nie zwracamy ani nie logujemy — tylko komunikat błędu.
    console.error('request-calculation:', e instanceof Error ? `${e.name}: ${e.message}` : 'nieznany błąd');
    return json(500, { error: 'server_error' });
  }
});
