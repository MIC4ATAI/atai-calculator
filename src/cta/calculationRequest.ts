/**
 * Żądanie do Edge Function `request-calculation` (publiczna, chroniona tokenem sesji).
 * `email` może być pominięty: wtedy to prośba o ponowną wysyłkę na adres zablokowany po pierwszej udanej wysyłce.
 * Poprawność formatu adresu sprawdza `decideCta` (odrzucenie `invalid_email`), nie ten parser.
 */
import { isValidToken } from '../session/guestRequest.ts';

/** Surowy adres dłuższy niż to nie jest adresem e-mail — odrzucamy bez dalszego przetwarzania. */
const MAX_RAW_EMAIL = 320;

export type CalculationRequestParse =
  | { ok: true; token: string; email: string | null }
  | { ok: false; error: 'bad_request' };

export function parseCalculationRequest(body: unknown): CalculationRequestParse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'bad_request' };
  const b = body as Record<string, unknown>;

  if (!isValidToken(b.token)) return { ok: false, error: 'bad_request' };

  if (b.email === undefined || b.email === null) return { ok: true, token: b.token, email: null };
  if (typeof b.email !== 'string' || b.email.length > MAX_RAW_EMAIL) return { ok: false, error: 'bad_request' };
  return { ok: true, token: b.token, email: b.email };
}
