// Dostarczanie powiadomień dla konsultanta (outbox → webhook n8n) z Edge Functions.
// Logika jest w src/notify (testowana w Vitest); tu tylko zależności środowiska: baza (service role), fetch i waitUntil.
import { readNotifyConfig } from '../../../src/notify/config.ts';
import { dispatchNotifications, type DispatchSummary } from '../../../src/notify/dispatch.ts';
import { admin } from './admin.ts';

declare const EdgeRuntime: { waitUntil?: (promise: Promise<unknown>) => void } | undefined;

const SEND_TIMEOUT_MS = 8000;
/** Ile wpisów odbieramy za jednym razem; reszta poczeka na kolejne żądanie. */
const BATCH = 20;

/** Jedna paczka (do BATCH wpisów); null = wysyłka niedostępna (wyłączona albo błędnie skonfigurowana). */
async function run(): Promise<DispatchSummary | null> {
  const config = readNotifyConfig((name) => Deno.env.get(name));
  if (!config.ok) {
    // „Nie skonfigurowano” to świadome wyłączenie powiadomień; pozostałe przyczyny to błąd do poprawienia.
    if (config.reason !== 'not_configured') console.error(`notify: błędna konfiguracja (${config.reason})`);
    return null;
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
  return summary;
}

/** Maksymalna liczba paczek na jedno wywołanie crona (reszta poczeka na kolejną minutę). */
const MAX_BATCHES = 5;

/**
 * Dostarcza zaległe powiadomienia (zadanie crona i ręczne wywołania `dispatch-notifications`): paczka po paczce, aż
 * outbox się opróżni albo wyczerpie limit paczek. `configured: false` = wysyłka wyłączona lub błędna konfiguracja.
 */
export async function dispatchPending(): Promise<{ configured: boolean; sent: number; skipped: number; retried: number }> {
  const total = { configured: true, sent: 0, skipped: 0, retried: 0 };
  for (let i = 0; i < MAX_BATCHES; i += 1) {
    const summary = await run();
    if (summary === null) return { ...total, configured: false };
    total.sent += summary.sent;
    total.skipped += summary.skipped;
    total.retried += summary.retried;
    // Pusta paczka lub same ponowienia (awaria odbiornika): nie ma sensu odpytywać dalej w tym wywołaniu.
    if (summary.sent + summary.skipped === 0) break;
  }
  return total;
}

/**
 * Uruchamia dostarczanie w tle po odpowiedzi dla klienta (EdgeRuntime.waitUntil) — alert nie opóźnia odpowiedzi
 * i nie może jej zepsuć. Wpisy, które się nie udały, wracają przy kolejnym żądaniu (baza ogranicza próby do 5).
 */
export function dispatchInBackground(): void {
  const task = run().then(() => undefined).catch((e) => console.error('notify:', e instanceof Error ? e.message : 'błąd'));
  if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime?.waitUntil === 'function') EdgeRuntime.waitUntil(task);
}
