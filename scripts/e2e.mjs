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
import { existsSync, readFileSync } from 'node:fs';

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

// Powiadomienia: testy uruchamiają odbiornik webhooka na hoście, a funkcje (w kontenerze) wysyłają do niego przez adres
// z N8N_WEBHOOK_URL w supabase/functions/.env (plik lokalny, w .gitignore). Port i sekret czytamy stamtąd i przekazujemy
// tylko procesowi testów; sekret nie jest wypisywany. Bez tej konfiguracji scenariusze powiadomień są pomijane.
let webhookPort = '';
let webhookSecret = '';
const functionsEnv = new URL('../supabase/functions/.env', import.meta.url);
if (existsSync(functionsEnv)) {
  const vars = Object.fromEntries(
    readFileSync(functionsEnv, 'utf8')
      .split('\n')
      .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
  try {
    const url = new URL(vars.N8N_WEBHOOK_URL ?? '');
    if (['host.docker.internal', 'localhost', '127.0.0.1'].includes(url.hostname) && url.port && vars.N8N_WEBHOOK_SECRET) {
      webhookPort = url.port;
      webhookSecret = vars.N8N_WEBHOOK_SECRET;
    }
  } catch {
    /* brak lub zły adres — powiadomienia zostaną pominięte */
  }
}
if (!webhookPort) {
  console.warn(
    '\n⚠ Scenariusze powiadomień zostaną pominięte: ustaw w supabase/functions/.env N8N_WEBHOOK_URL=http://host.docker.internal:54399/hook\n' +
      '  oraz N8N_WEBHOOK_SECRET (min. 16 znaków) i zrestartuj `supabase functions serve`.\n',
  );
}

const child = spawn('npx', ['vitest', 'run', '--config', 'vitest.e2e.config.ts', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    E2E_API_URL: apiUrl,
    E2E_PUBLISHABLE_KEY: publishableKey,
    E2E_SERVICE_ROLE_KEY: serviceRoleKey,
    E2E_MAILPIT_URL: mailpitUrl,
    ...(webhookPort ? { E2E_WEBHOOK_PORT: webhookPort, E2E_WEBHOOK_SECRET: webhookSecret } : {}),
  },
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
