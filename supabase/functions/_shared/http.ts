// Wspólne elementy publicznych Edge Functions (dostęp rozmówcy po tokenie sesji): CORS, odpowiedzi JSON
// i bezpieczny odczyt ciała żądania.
import { MAX_BODY_BYTES } from '../../../src/session/guestRequest.ts';

// Funkcje są publiczne i chronione tokenem sesji, nie cookies — wystarczy otwarte CORS.
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Odpowiada na preflight (OPTIONS) i odrzuca metody inne niż POST; dla POST zwraca null. */
export function handleNonPost(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  return null;
}

export type JsonBody = { ok: true; value: unknown } | { ok: false; response: Response };

/** Czyta ciało jako JSON z limitem rozmiaru: 413 za duże, 400 gdy to nie JSON. */
export async function readJsonBody(req: Request, maxBytes: number = MAX_BODY_BYTES): Promise<JsonBody> {
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > maxBytes) return { ok: false, response: json(413, { error: 'too_large' }) };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, response: json(400, { error: 'bad_request' }) };
  }
}
