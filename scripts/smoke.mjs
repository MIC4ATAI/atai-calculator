#!/usr/bin/env node
/**
 * Kontrola po wdrożeniu (lokalnie lub na produkcji): czy publiczne funkcje odpowiadają, czy anonimowy użytkownik NIE ma
 * dostępu do tabel i (opcjonalnie) czy aplikacja na Vercelu przepisuje trasy SPA.
 *
 *   node scripts/smoke.mjs <adres Supabase> <klucz publiczny (anon/publishable)> [adres aplikacji]
 *   npm run smoke -- https://<ref>.supabase.co <klucz> https://atai.mitax.pl
 *
 * Używa wyłącznie klucza PUBLICZNEGO i nieistniejących tokenów: niczego nie tworzy ani nie zmienia w bazie. Nie sprawdza
 * poczty, GUS ani n8n (to wymaga prawdziwych danych — patrz docs/deploy.md, „Próba końcowa”).
 */
const [supabaseUrl, anonKey, appUrl] = process.argv.slice(2);
if (!supabaseUrl || !anonKey) {
  console.error('Użycie: node scripts/smoke.mjs <adres Supabase> <klucz publiczny> [adres aplikacji]');
  process.exit(2);
}
const base = supabaseUrl.replace(/\/+$/, '');
const TOKEN = 'smoke-test-nieistniejacy-token-0000';

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (e) {
    results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
}
const expect = (cond, message) => {
  if (!cond) throw new Error(message);
};

async function post(fn, body, headers = {}) {
  const res = await fetch(`${base}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* odpowiedź bez JSON-a */
  }
  return { status: res.status, json, headers: res.headers };
}

await check('guest-session: nieznany token → 404 not_found', async () => {
  const r = await post('guest-session', { action: 'get', token: TOKEN });
  expect(r.status === 404 && r.json?.error === 'not_found', `HTTP ${r.status} ${JSON.stringify(r.json)}`);
});
await check('guest-session: zły token → 400, nieznana akcja → 400', async () => {
  expect((await post('guest-session', { action: 'get', token: 'x' })).status === 400, 'zły token');
  expect((await post('guest-session', { action: 'usun', token: TOKEN })).status === 400, 'zła akcja');
});
await check('guest-session: GET → 405, OPTIONS → 204 z nagłówkami CORS', async () => {
  const get = await fetch(`${base}/functions/v1/guest-session`, { headers: { apikey: anonKey } });
  expect(get.status === 405, `GET: HTTP ${get.status}`);
  const options = await fetch(`${base}/functions/v1/guest-session`, { method: 'OPTIONS', headers: { apikey: anonKey } });
  expect(options.status === 204 && options.headers.get('access-control-allow-origin') === '*', `OPTIONS: HTTP ${options.status}`);
});
await check('lookup-company: nieznany token → 404; zła suma kontrolna NIP → 400', async () => {
  expect((await post('lookup-company', { token: TOKEN, nip: '5261040567' })).status === 404, 'nieznany token');
  expect((await post('lookup-company', { token: TOKEN, nip: '5261040568' })).status === 400, 'zły NIP');
});
await check('request-calculation: nieznany token → 404 (nic nie jest wysyłane)', async () => {
  const r = await post('request-calculation', { token: TOKEN, email: 'smoke@example.com' });
  expect(r.status === 404, `HTTP ${r.status} ${JSON.stringify(r.json)}`);
});
await check('dispatch-notifications: bez sekretu i ze złym sekretem → 401 (nie 503: DISPATCH_SECRET musi być ustawiony)', async () => {
  const none = await post('dispatch-notifications', {});
  expect(none.status !== 503, 'HTTP 503: brak DISPATCH_SECRET w środowisku funkcji');
  expect(none.status === 401, `bez sekretu: HTTP ${none.status}`);
  const wrong = await post('dispatch-notifications', {}, { 'X-Dispatch-Secret': 'zly-sekret-smoke' });
  expect(wrong.status === 401, `zły sekret: HTTP ${wrong.status}`);
});
for (const table of ['calc_sessions', 'calc_snapshots', 'calc_events', 'leads', 'lead_deliveries', 'companies', 'session_visits', 'notification_outbox', 'profiles', 'organizations']) {
  await check(`REST: anonimowy odczyt tabeli ${table} jest zabroniony`, async () => {
    const res = await fetch(`${base}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } });
    const text = await res.text();
    // Zabronione = błąd uprawnień (401/403) albo pusta lista; NIGDY wiersze z danymi.
    expect(res.status !== 200 || text.trim() === '[]', `HTTP ${res.status}: dane widoczne anonimowo (${text.slice(0, 80)})`);
    expect(res.status === 401 || res.status === 403 || res.status === 404, `oczekiwano błędu uprawnień, jest HTTP ${res.status}`);
  });
}
if (appUrl) {
  const app = appUrl.replace(/\/+$/, '');
  for (const path of ['/login', `/s/${TOKEN}`, '/session/00000000-0000-0000-0000-000000000000/follow-up', '/polityka-prywatnosci']) {
    await check(`aplikacja: ${path} → 200 z index.html (przepisywanie tras SPA)`, async () => {
      const res = await fetch(`${app}${path}`, { signal: AbortSignal.timeout(30_000) });
      const html = await res.text();
      expect(res.status === 200 && html.includes('<div id="root"'), `HTTP ${res.status}`);
    });
  }
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? '✓' : '✖'} ${r.name}${r.ok ? '' : `\n    ${r.detail}`}`);
}
console.log(`\n${results.length - failed}/${results.length} kontroli przeszło${failed ? `, ${failed} NIE` : ''}.`);
process.exit(failed ? 1 : 0);
