/**
 * Walidacja żądania do Edge Function `lookup-company` (publiczna, chroniona tokenem sesji).
 * Walidacja sumy kontrolnej NIP-u jest tu, po stronie serwera — nie tylko w przeglądarce.
 */
import { isValidNip, normalizeNip } from '../calc/nip.ts';
import { isValidToken } from '../session/guestRequest.ts';

export type LookupParse =
  | { ok: true; token: string; nip: string }
  | { ok: false; error: 'bad_request' | 'invalid_nip' };

export function parseLookupRequest(body: unknown): LookupParse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'bad_request' };
  const b = body as Record<string, unknown>;

  if (!isValidToken(b.token)) return { ok: false, error: 'bad_request' };
  if (typeof b.nip !== 'string' || b.nip.length > 32) return { ok: false, error: 'bad_request' };

  if (!isValidNip(b.nip)) return { ok: false, error: 'invalid_nip' };
  return { ok: true, token: b.token, nip: normalizeNip(b.nip) };
}
