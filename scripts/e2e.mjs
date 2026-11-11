#!/usr/bin/env node
/**
 * Uruchamia testy end-to-end etapu 2 na LOKALNYM stosie Supabase.
 *
 * Wymagane (każdy w osobnym terminalu / w tle):
 *   supabase start -x logflare,vector,imgproxy,studio
 *   supabase db reset                      # seed: organizacje, konsultanci (czysty stan)
 *   supabase functions serve               # Edge Functions (z supabase/functions/.env — poczta: Mailpit)
 *
 * Skrypt sprawdza, czy to wszystko działa, odczytuje adres API, klucze i adres Mailpita z `supabase status`
 * i przekazuje je testom WYŁĄCZNIE przez zmienne środowiskowe procesu — nic nie jest wypisywane ani zapisywane,
 * więc żadne klucze (nawet lokalne) nie trafiają do repozytorium.
 *
 * Testy zapisują dane w lokalnej bazie (leady i dostawy są tylko do dopisywania) — `supabase db reset` je czyści.
 */
import { execFileSync, spawn } from 'node:child_process';

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(2);
}

let status;
try {
  status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch {
  fail('Nie udało się odczytać stanu Supabase. Uruchom lokalny stos:\n    supabase start -x logflare,vector,imgproxy,studio');
}

const apiUrl = status.API_URL;
const publishableKey = status.PUBLISHABLE_KEY;
const serviceRoleKey = status.SERVICE_ROLE_KEY;
const mailpitUrl = status.MAILPIT_URL;
if (!apiUrl || !publishableKey || !serviceRoleKey || !mailpitUrl) {
  fail('Stos Supabase nie jest w pełni uruchomiony (brak adresu API, kluczy lub Mailpita w `supabase status`).');
}

// Edge Functions: nieistniejący token musi dać 404 z naszej funkcji (a nie błąd bramy).
try {
  const res = await fetch(`${apiUrl}/functions/v1/guest-session`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'get', token: 'e2e-sprawdzenie-stosu' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status !== 404) throw new Error(`HTTP ${res.status}`);
} catch {
  fail('Edge Functions nie odpowiadają. Uruchom w osobnym terminalu:\n    supabase functions serve');
}

try {
  const res = await fetch(`${mailpitUrl}/api/v1/messages`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch {
  fail('Mailpit nie odpowiada (powinien działać razem z `supabase start`).');
}

const child = spawn('npx', ['vitest', 'run', '--config', 'vitest.e2e.config.ts', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    E2E_API_URL: apiUrl,
    E2E_PUBLISHABLE_KEY: publishableKey,
    E2E_SERVICE_ROLE_KEY: serviceRoleKey,
    E2E_MAILPIT_URL: mailpitUrl,
  },
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
