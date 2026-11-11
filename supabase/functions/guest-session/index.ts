// Edge Function: dostęp rozmówcy do sesji po tokenie z linku (bez logowania).
//
// Rozmówca nie dostaje żadnego dostępu do tabel. Cały jego dostęp idzie tędy, przez service role
// po stronie serwera, a odpowiedź to widok bezpieczny dla rozmówcy (src/session/guestView.ts):
//   - bez cichych założeń (params),
//   - wynik dopiero po odsłonięciu przez konsultanta,
//   - zapis wyłącznie dozwolonych pól: dane, miks suwaka, odpowiedź.
// Obliczenia robi src/calc (ta sama implementacja co w aplikacji).
//
// POST { action: 'get', token }
// POST { action: 'patch', token, patch?: {kh, kpir, ...}, mixKh?: number, reply?: string }
// → 200 { view } | 400 { error: 'bad_request' } | 404 { error: 'not_found' } | 405 | 413 | 500

import { createClient } from 'npm:@supabase/supabase-js@2';
import { MAX_BODY_BYTES, parseGuestRequest } from '../../../src/session/guestRequest.ts';
import { buildGuestView, type SessionRow } from '../../../src/session/guestView.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Funkcja jest publiczna i chroniona tokenem, nie cookies — wystarczy otwarte CORS.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Widok sesji po tokenie; null, gdy sesji nie ma albo jest zarchiwizowana. */
async function loadView(token: string) {
  const { data, error } = await supabase
    .from('calc_sessions')
    .select('inputs, params, revealed, mix_kh, reply, status')
    .eq('token', token)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status === 'archived') return null;
  return buildGuestView(data as SessionRow);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { error: 'too_large' });

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: 'bad_request' });
    }

    const parsed = parseGuestRequest(body);
    if (!parsed.ok) return json(400, { error: 'bad_request' });
    const request = parsed.request;

    if (request.action === 'patch') {
      const { data: updated, error } = await supabase.rpc('guest_patch_calc_session', {
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
    return json(200, { view });
  } catch (e) {
    // Szczegółów nie zwracamy rozmówcy — tylko do logów funkcji.
    console.error('guest-session:', e instanceof Error ? e.message : e);
    return json(500, { error: 'server_error' });
  }
});
