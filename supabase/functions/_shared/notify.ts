// Dostarczanie powiadomień dla konsultanta (outbox → webhook n8n) z Edge Functions.
// Logika jest w src/notify (testowana w Vitest); tu tylko zależności środowiska: baza (service role), fetch i waitUntil.
import { readNotifyConfig } from '../../../src/notify/config.ts';
import { dispatchNotifications } from '../../../src/notify/dispatch.ts';
import { admin } from './admin.ts';

declare const EdgeRuntime: { waitUntil?: (promise: Promise<unknown>) => void } | undefined;

const SEND_TIMEOUT_MS = 8000;
/** Ile wpisów odbieramy za jednym razem; reszta poczeka na kolejne żądanie. */
const BATCH = 20;

async function run(): Promise<void> {
  const config = readNotifyConfig((name) => Deno.env.get(name));
  if (!config.ok) {
    // „Nie skonfigurowano” to świadome wyłączenie powiadomień; pozostałe przyczyny to błąd do poprawienia.
    if (config.reason !== 'not_configured') console.error(`notify: błędna konfiguracja (${config.reason})`);
    return;
  }

  const summary = await dispatchNotifications({
    config: config.config,
    claim: async () => {
      const { data, error } = await admin.rpc('claim_notifications', { p_limit: BATCH });
      if (error) throw error;
      return data;
    },
    finish: async (id, outcome) => {
      const { error } = await admin.rpc('finish_notification', { p_id: id, p_outcome: outcome });
      if (error) throw error;
    },
    send: async (request) => {
      // Przekierowania nie są śledzone: podpisana treść nie ma trafić pod inny adres niż skonfigurowany.
      const res = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        redirect: 'error',
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      await res.body?.cancel();
      return res.status;
    },
    now: () => Date.now(),
    log: (message) => console.error(message),
  });

  if (summary.sent + summary.skipped + summary.retried > 0) {
    console.log(`notify: wysłano ${summary.sent}, pominięto ${summary.skipped}, do ponowienia ${summary.retried}`);
  }
}

/**
 * Uruchamia dostarczanie w tle po odpowiedzi dla klienta (EdgeRuntime.waitUntil) — alert nie opóźnia odpowiedzi
 * i nie może jej zepsuć. Wpisy, które się nie udały, wracają przy kolejnym żądaniu (baza ogranicza próby do 5).
 */
export function dispatchInBackground(): void {
  const task = run().catch((e) => console.error('notify:', e instanceof Error ? e.message : 'błąd'));
  if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime?.waitUntil === 'function') EdgeRuntime.waitUntil(task);
}
