/**
 * Walidacja żądań rozmówcy do Edge Function `guest-session`. Czysta logika (importowana też w Deno).
 * Funkcja jest publiczna (bez JWT), więc niczemu nie ufamy: pola spoza listy znikają, długości są ograniczone.
 */
import { sanitizeInputs, type SessionInputs } from './guestView.ts';

export const MAX_REPLY_LENGTH = 2000;
export const MAX_MIX_KH = 1_000_000;
/** Maksymalny rozmiar ciała żądania, bajty. */
export const MAX_BODY_BYTES = 16 * 1024;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** Token sesji z linku rozmówcy: 8–128 znaków [A-Za-z0-9_-] (prawdziwe mają 48 znaków hex). */
export function isValidToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

export type GuestRequest =
  | { action: 'get'; token: string }
  | {
      action: 'patch';
      token: string;
      /** Zmieniane pola danych (już przefiltrowane). */
      patch: SessionInputs;
      /** null = bez zmiany. */
      mixKh: number | null;
      /** null = bez zmiany. */
      reply: string | null;
    };

export type ParseResult = { ok: true; request: GuestRequest } | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });

export function parseGuestRequest(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail('Ciało żądania musi być obiektem');
  const b = body as Record<string, unknown>;

  if (!isValidToken(b.token)) return fail('Niepoprawny token');
  const token = b.token;

  if (b.action === 'get') return { ok: true, request: { action: 'get', token } };
  if (b.action !== 'patch') return fail('Nieznana akcja');

  let mixKh: number | null = null;
  if (b.mixKh !== undefined && b.mixKh !== null) {
    if (typeof b.mixKh !== 'number' || !Number.isInteger(b.mixKh) || b.mixKh < 0 || b.mixKh > MAX_MIX_KH) {
      return fail('Niepoprawny miks');
    }
    mixKh = b.mixKh;
  }

  let reply: string | null = null;
  if (b.reply !== undefined && b.reply !== null) {
    if (typeof b.reply !== 'string' || b.reply.length > MAX_REPLY_LENGTH) return fail('Niepoprawna odpowiedź');
    reply = b.reply;
  }

  if (b.patch !== undefined && (typeof b.patch !== 'object' || b.patch === null || Array.isArray(b.patch))) {
    return fail('Niepoprawne dane');
  }

  return { ok: true, request: { action: 'patch', token, patch: sanitizeInputs(b.patch), mixKh, reply } };
}
