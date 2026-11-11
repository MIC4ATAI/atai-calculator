// Edge Function: dostarczanie zaległych powiadomień dla konsultantów (outbox → webhook n8n).
// Wywołuje ją zadanie pg_cron co minutę (gdy w outboxie coś czeka) albo operator ręcznie.
//
// Nie jest to funkcja publiczna: wymaga nagłówka X-Dispatch-Secret zgodnego z DISPATCH_SECRET (min. 32 znaki).
// Bramka Supabase nie sprawdza tu JWT (verify_jwt = false), bo wywołuje ją baza, a nie przeglądarka.
//
// POST (ciało dowolne)
// → 200 { configured, sent, skipped, retried }   configured=false: N8N_WEBHOOK_* nie są ustawione lub są błędne
// → 401 { error: 'unauthorized' } | 405 | 503 { error: 'not_configured' } (brak DISPATCH_SECRET) | 500

import { MIN_DISPATCH_SECRET_LENGTH, secretsEqual } from '../../../src/notify/secret.ts';
import { handleNonPost, json } from '../_shared/http.ts';
import { dispatchPending } from '../_shared/notify.ts';

Deno.serve(async (req) => {
  const early = handleNonPost(req);
  if (early) return early;

  const expected = Deno.env.get('DISPATCH_SECRET')?.trim() ?? '';
  if (expected.length < MIN_DISPATCH_SECRET_LENGTH) {
    console.error('dispatch-notifications: brak lub zbyt krótki DISPATCH_SECRET');
    return json(503, { error: 'not_configured' });
  }
  const given = req.headers.get('x-dispatch-secret') ?? '';
  if (given === '' || !(await secretsEqual(given, expected))) return json(401, { error: 'unauthorized' });

  try {
    return json(200, await dispatchPending());
  } catch (e) {
    console.error('dispatch-notifications:', e instanceof Error ? e.message : 'błąd');
    return json(500, { error: 'server_error' });
  }
});
