import { FunctionsHttpError } from '@supabase/supabase-js';
import type { CompanyView } from '../company/companyView';
import { lookupErrorKind, type LookupErrorKind } from '../company/lookupErrors';
import type { CtaView } from '../cta/ctaPolicy';
import { requestErrorKind, type RequestErrorKind } from '../cta/requestErrors';
import { supabase } from '../lib/supabase';
import type { GuestView, SessionInputs } from './guestView';

export type GuestCall =
  | { action: 'get'; token: string }
  | { action: 'patch'; token: string; patch: SessionInputs; mixKh?: number; reply?: string };

export type GuestCallResult =
  | { ok: true; view: GuestView }
  | { ok: false; kind: 'not_found' | 'unavailable' };

/**
 * Wywołanie Edge Function `guest-session`. Rozmówca nie ma dostępu do tabel — tylko do tej funkcji.
 * 404 = sesja nie istnieje lub jest zarchiwizowana; wszystko inne (sieć, 5xx) traktujemy jako chwilową niedostępność.
 */
export async function callGuest(body: GuestCall): Promise<GuestCallResult> {
  const { data, error } = await supabase.functions.invoke<{ view: GuestView }>('guest-session', { body });
  if (error) {
    if (error instanceof FunctionsHttpError && error.context instanceof Response && error.context.status === 404) {
      return { ok: false, kind: 'not_found' };
    }
    return { ok: false, kind: 'unavailable' };
  }
  if (!data?.view) return { ok: false, kind: 'unavailable' };
  return { ok: true, view: data.view };
}

export type LookupCallResult = { ok: true; company: CompanyView } | { ok: false; kind: LookupErrorKind };

/**
 * Wywołanie Edge Function `lookup-company`: NIP rozmówcy → firma z GUS przypięta do sesji.
 * Kod HTTP i pole `error` z odpowiedzi serwera zamieniamy na rodzaj błędu (komunikaty: lookupErrors).
 */
export async function callLookup(token: string, nip: string): Promise<LookupCallResult> {
  const { data, error } = await supabase.functions.invoke<{ company: CompanyView }>('lookup-company', {
    body: { token, nip },
  });
  if (error) {
    let status: number | null = null;
    let code: string | null = null;
    if (error instanceof FunctionsHttpError && error.context instanceof Response) {
      status = error.context.status;
      try {
        const body: unknown = await error.context.json();
        const value = (body as { error?: unknown } | null)?.error;
        code = typeof value === 'string' ? value : null;
      } catch {
        /* odpowiedź bez JSON-a — zostaje sam kod HTTP */
      }
    }
    return { ok: false, kind: lookupErrorKind(status, code) };
  }
  if (!data?.company) return { ok: false, kind: 'unavailable' };
  return { ok: true, company: data.company };
}

export type CalcRequestResult =
  | { ok: true; cta: CtaView; /** Podwójne kliknięcie: nic nie wysłano, bo mail wyszedł przed chwilą. */ duplicate: boolean }
  | { ok: false; kind: RequestErrorKind; cta: CtaView | null };

/**
 * Wywołanie Edge Function `request-calculation`: CTA „Przyślij mi kalkulację”. `email` = null oznacza ponowną
 * wysyłkę na adres zablokowany po pierwszej udanej wysyłce (rozmówca zna tylko jego zamaskowaną wersję).
 */
export async function callRequestCalculation(token: string, email: string | null): Promise<CalcRequestResult> {
  const { data, error } = await supabase.functions.invoke<{ cta: CtaView; duplicate?: boolean }>('request-calculation', {
    body: email === null ? { token } : { token, email },
  });
  if (error) {
    let status: number | null = null;
    let code: string | null = null;
    let cta: CtaView | null = null;
    if (error instanceof FunctionsHttpError && error.context instanceof Response) {
      status = error.context.status;
      try {
        const body = (await error.context.json()) as { error?: unknown; cta?: CtaView } | null;
        code = typeof body?.error === 'string' ? body.error : null;
        cta = body?.cta ?? null;
      } catch {
        /* odpowiedź bez JSON-a — zostaje sam kod HTTP */
      }
    }
    return { ok: false, kind: requestErrorKind(status, code), cta };
  }
  if (!data?.cta) return { ok: false, kind: 'unavailable', cta: null };
  return { ok: true, cta: data.cta, duplicate: data.duplicate === true };
}
