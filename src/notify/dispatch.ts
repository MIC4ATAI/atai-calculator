/**
 * Dostarczanie powiadomień z outboxu do webhooka n8n. Czysta logika z wstrzykiwanymi zależnościami (RPC bazy, HTTP,
 * czas), więc działa tak samo w Edge Function i w testach.
 *
 * Gwarancje:
 *  - wpis jest przejmowany atomowo przez bazę (claim_notifications), więc równoległe żądania nie wyślą go dwa razy;
 *  - sukces = odpowiedź 2xx odbiornika; każda inna odpowiedź albo wyjątek = ponowienie (baza kończy po 5 próbach);
 *  - brak adresata w profilu = wpis pominięty bez wysyłania;
 *  - żaden błąd nie wychodzi na zewnątrz — alert nie może zepsuć odpowiedzi klientowi.
 */
import type { NotifyConfig } from './config.ts';
import { buildNotification, parseClaimed } from './payload.ts';
import { signPayload } from './signature.ts';

export type Outcome = 'sent' | 'skipped' | 'retry';

export interface WebhookRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface DispatchDeps {
  config: NotifyConfig;
  /** claim_notifications: surowy wynik RPC (tablica JSON). */
  claim: () => Promise<unknown>;
  /** finish_notification. */
  finish: (id: number, outcome: Outcome) => Promise<void>;
  /** Wysyła żądanie i zwraca kod HTTP; wyjątek = awaria sieci lub przekroczony czas. */
  send: (request: WebhookRequest) => Promise<number>;
  /** Czas w milisekundach (do znacznika X-Timestamp). */
  now: () => number;
  /** Komunikaty diagnostyczne bez danych wrażliwych (bez sekretu, adresu webhooka i treści alertów). */
  log?: (message: string) => void;
}

export interface DispatchSummary {
  sent: number;
  skipped: number;
  retried: number;
  invalid: number;
}

export async function dispatchNotifications(deps: DispatchDeps): Promise<DispatchSummary> {
  const summary: DispatchSummary = { sent: 0, skipped: 0, retried: 0, invalid: 0 };
  const log = deps.log ?? (() => undefined);

  let claimed: unknown;
  try {
    claimed = await deps.claim();
  } catch {
    log('notify: nie udało się odebrać powiadomień z outboxu');
    return summary;
  }
  const { rows, invalid } = parseClaimed(claimed);
  summary.invalid = invalid;
  if (invalid > 0) log(`notify: pominięto ${invalid} wpisów w nieoczekiwanym kształcie`);

  for (const row of rows) {
    let outcome: Outcome;
    const payload = buildNotification(row, deps.config.appBaseUrl);
    if (!payload) {
      outcome = 'skipped';
    } else {
      try {
        const body = JSON.stringify(payload);
        const timestamp = String(Math.floor(deps.now() / 1000));
        const status = await deps.send({
          url: deps.config.webhookUrl,
          headers: {
            'Content-Type': 'application/json',
            'X-Timestamp': timestamp,
            'X-Event-Id': payload.eventId,
            'X-Signature': await signPayload(deps.config.secret, timestamp, body),
          },
          body,
        });
        outcome = status >= 200 && status < 300 ? 'sent' : 'retry';
        if (outcome === 'retry') log(`notify: odbiorca odpowiedział ${status} (wpis ${row.id})`);
      } catch {
        outcome = 'retry';
        log(`notify: awaria wysyłki (wpis ${row.id})`);
      }
    }

    try {
      await deps.finish(row.id, outcome);
    } catch {
      log(`notify: nie udało się zamknąć wpisu ${row.id}`);
    }
    if (outcome === 'sent') summary.sent += 1;
    else if (outcome === 'skipped') summary.skipped += 1;
    else summary.retried += 1;
  }
  return summary;
}
