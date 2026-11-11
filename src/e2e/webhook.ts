/**
 * Odbiornik webhooka n8n na potrzeby testów e2e: prosty serwer HTTP na hoście, do którego kontener Edge Functions
 * sięga przez host.docker.internal. Sam weryfikuje podpis i świeżość żądania DOKŁADNIE tak, jak powinien to robić
 * workflow n8n (docs/n8n-followup.md), a zapisuje wynik weryfikacji, żeby testy mogły go sprawdzić.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';

export interface ReceivedWebhook {
  receivedAt: number;
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  /** Podpis zgodny z sekretem i znacznik czasu to same cyfry. */
  signatureOk: boolean;
  /** Znacznik czasu nie starszy niż 5 minut. */
  fresh: boolean;
  /** Status, którym odpowiedział odbiornik (200 albo zaprogramowana awaria). */
  respondedWith: number;
}

export interface Behavior {
  /** Kod odpowiedzi (domyślnie 200). */
  status?: number;
  /** Opóźnienie odpowiedzi, ms. */
  delayMs?: number;
}

export interface WebhookReceiver {
  requests: ReceivedWebhook[];
  /**
   * Najbliższe `times` żądań dotyczących sesji `sessionId` dostanie podane zachowanie (potem znów 200 bez opóźnienia).
   * Zachowanie jest przypisane do sesji, bo odbiornik współdzielą równolegle działające pliki testów.
   */
  next(sessionId: string, behavior: Behavior, times?: number): void;
  /** Czeka, aż pojawi się żądanie spełniające warunek (odpytywanie co 100 ms); rzuca po upływie czasu. */
  waitFor(predicate: (r: ReceivedWebhook) => boolean, timeoutMs?: number): Promise<ReceivedWebhook>;
  /** Żądania dotyczące sesji (po identyfikatorze w linku do follow-upu). */
  forSession(sessionId: string): ReceivedWebhook[];
  close(): Promise<void>;
}

export async function startWebhookReceiver(port: number, secret: string): Promise<WebhookReceiver> {
  const requests: ReceivedWebhook[] = [];
  const queue: { sessionId: string; behavior: Behavior }[] = [];

  const server: Server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (raw += chunk));
    req.on('end', () => {
      const timestamp = String(req.headers['x-timestamp'] ?? '');
      const signature = String(req.headers['x-signature'] ?? '');
      const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}`;
      const a = Buffer.from(signature);
      const b = Buffer.from(expected);
      const signatureOk = /^[0-9]{1,12}$/.test(timestamp) && a.length === b.length && timingSafeEqual(a, b);
      const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300;
      let payload: unknown = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        /* treść bez JSON-a — test to zauważy */
      }
      const sessionUrl = (payload as { sessionUrl?: unknown } | null)?.sessionUrl;
      const index = typeof sessionUrl === 'string' ? queue.findIndex((q) => sessionUrl.includes(q.sessionId)) : -1;
      const behavior = index >= 0 ? queue.splice(index, 1)[0]!.behavior : {};
      const status = behavior.status ?? 200;
      requests.push({ receivedAt: Date.now(), headers: req.headers, rawBody: raw, payload, signatureOk, fresh, respondedWith: status });
      setTimeout(() => {
        res.statusCode = status;
        res.end('ok');
      }, behavior.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve());
  });

  return {
    requests,
    next: (sessionId, behavior, times = 1) => {
      for (let i = 0; i < times; i += 1) queue.push({ sessionId, behavior });
    },
    waitFor: async (predicate, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = requests.find(predicate);
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`Odbiornik webhooka nie dostał oczekiwanego żądania w ${timeoutMs} ms`);
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    forSession: (sessionId) => requests.filter((r) => typeof r.payload?.sessionUrl === 'string' && r.payload.sessionUrl.includes(sessionId)),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
