/**
 * Kontrakt nadawca ↔ workflow n8n: kod z węzła Code w docs/n8n-followup-workflow.json jest wykonywany na prawdziwych
 * ładunkach i podpisach z src/notify. Test nie uruchamia n8n (to szablon do importu), ale pilnuje, żeby weryfikacja
 * podpisu, okno czasowe i deduplikacja działały dokładnie tak, jak opisuje docs/n8n-followup.md.
 */
import * as nodeCrypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildNotification, type ClaimedNotification } from './payload.ts';
import { signPayload } from './signature.ts';

const files = import.meta.glob('../../docs/n8n-followup-workflow.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const workflow = JSON.parse(Object.values(files)[0]!) as {
  nodes: { name: string; type: string; parameters: Record<string, unknown> }[];
  connections: Record<string, { main: { node: string }[][] }>;
};

const SECRET = 'sekret-do-podpisu-1234';
const NOW = 1_762_860_000_000;
const row: ClaimedNotification = {
  id: 9,
  kind: 'client_changed',
  newVisit: false,
  createdAt: '2026-11-11T17:52:00.000Z',
  sessionId: '2417ec05-8f82-4a86-9313-1d34c7063f65',
  organization: 'MITAX Consulting sp. z o.o.',
  consultantName: 'Ola Konsultant',
  channel: 'telegram',
  target: '123456789',
  changedFields: 2,
};

type Item = { headers: Record<string, string>; body: unknown };
type Out = { json: { send: boolean; status: number; reason?: string; chatId?: string; text?: string } }[];

const codeNode = workflow.nodes.find((n) => n.type === 'n8n-nodes-base.code')!;
const run = new Function('$input', '$env', '$getWorkflowStaticData', 'require', 'Date', String(codeNode.parameters.jsCode)) as (
  input: { first: () => { json: Item } },
  env: Record<string, string | undefined>,
  staticData: (scope: string) => Record<string, unknown>,
  req: (name: string) => unknown,
  date: { now: () => number },
) => Out;

/** Wykonuje kod węzła tak jak n8n: nagłówki małymi literami i sparsowane ciało z żądania HTTP. */
function execute(item: Item, opts: { secret?: string | undefined; store?: Record<string, unknown>; now?: number } = {}): Out {
  const store = opts.store ?? {};
  return run(
    { first: () => ({ json: item }) },
    { ATAI_WEBHOOK_SECRET: 'secret' in opts ? opts.secret : SECRET },
    () => store,
    (name) => {
      if (name !== 'crypto') throw new Error(`niedozwolony moduł: ${name}`);
      return nodeCrypto;
    },
    { now: () => opts.now ?? NOW },
  );
}

/** Żądanie dokładnie tak, jak wysyła je nadawca (dispatch.ts): ciało = JSON.stringify(payload). */
async function signedRequest(overrides: { timestamp?: string; secret?: string } = {}): Promise<Item> {
  const payload = buildNotification(row, 'https://atai.mitax.pl')!;
  const body = JSON.stringify(payload);
  const timestamp = overrides.timestamp ?? String(Math.floor(NOW / 1000));
  const signature = await signPayload(overrides.secret ?? SECRET, timestamp, body);
  return {
    headers: { 'x-timestamp': timestamp, 'x-signature': signature, 'x-event-id': payload.eventId, 'content-type': 'application/json' },
    body: JSON.parse(body),
  };
}

describe('workflow n8n: kod węzła „Sprawdź podpis i duplikaty”', () => {
  it('poprawne żądanie od nadawcy: wysyłamy alert do adresata z jego tekstem i linkiem', async () => {
    const [out] = execute(await signedRequest());
    expect(out!.json).toMatchObject({ send: true, status: 200, chatId: '123456789' });
    expect(out!.json.text).toBe(
      'MITAX Consulting sp. z o.o.: Klient zmienił dane w kalkulacji (zmienione pola: 2).\nhttps://atai.mitax.pl/session/2417ec05-8f82-4a86-9313-1d34c7063f65/follow-up',
    );
  });

  it('zły sekret, zmieniona treść i uszkodzony podpis → 401 „zly_podpis”', async () => {
    const wrongSecret = await signedRequest({ secret: 'inny-sekret-do-podpisu' });
    expect(execute(wrongSecret)[0]!.json).toMatchObject({ send: false, status: 401, reason: 'zly_podpis' });

    const tampered = await signedRequest();
    (tampered.body as { channel: { target: string } }).channel.target = '999999999';
    expect(execute(tampered)[0]!.json).toMatchObject({ send: false, status: 401, reason: 'zly_podpis' });

    const broken = await signedRequest();
    broken.headers['x-signature'] = 'sha256=zly';
    expect(execute(broken)[0]!.json).toMatchObject({ status: 401, reason: 'zly_podpis' });

    const missing = await signedRequest();
    delete missing.headers['x-signature'];
    expect(execute(missing)[0]!.json).toMatchObject({ status: 401, reason: 'zly_podpis' });
  });

  it('znacznik czasu: tylko cyfry i nie starszy niż 5 minut (ochrona przed powtórzeniem)', async () => {
    const stale = String(Math.floor(NOW / 1000) - 301);
    expect(execute(await signedRequest({ timestamp: stale }))[0]!.json).toMatchObject({ status: 401, reason: 'przeterminowane' });
    expect(execute(await signedRequest({ timestamp: String(Math.floor(NOW / 1000) - 299) }))[0]!.json.send).toBe(true);
    expect(execute(await signedRequest({ timestamp: String(Math.floor(NOW / 1000) + 400) }))[0]!.json.reason).toBe('przeterminowane');

    const bad = await signedRequest();
    bad.headers['x-timestamp'] = '1.2';
    expect(execute(bad)[0]!.json).toMatchObject({ status: 401, reason: 'zly_znacznik_czasu' });
    delete bad.headers['x-timestamp'];
    expect(execute(bad)[0]!.json).toMatchObject({ status: 401, reason: 'zly_znacznik_czasu' });
  });

  it('brak sekretu w n8n → 500 (nie przepuszczamy niczego bez weryfikacji)', async () => {
    expect(execute(await signedRequest(), { secret: undefined })[0]!.json).toMatchObject({ send: false, status: 500 });
    expect(execute(await signedRequest(), { secret: '' })[0]!.json).toMatchObject({ send: false, status: 500 });
  });

  it('ten sam alert drugi raz (ponowienie „co najmniej raz”) → 200 bez wysyłki na Telegram', async () => {
    const store: Record<string, unknown> = {};
    const req = await signedRequest();
    expect(execute(req, { store })[0]!.json.send).toBe(true);
    expect(execute(req, { store })[0]!.json).toMatchObject({ send: false, status: 200, reason: 'duplikat' });
    expect(store.seen).toEqual(['ntf-9']);
  });

  it('pamięć deduplikacji jest ograniczona do 500 ostatnich zdarzeń', async () => {
    const store: Record<string, unknown> = { seen: Array.from({ length: 500 }, (_, i) => `stare-${i}`) };
    execute(await signedRequest(), { store });
    expect((store.seen as string[]).length).toBe(500);
    expect((store.seen as string[]).at(-1)).toBe('ntf-9');
    expect((store.seen as string[])[0]).toBe('stare-1');
  });
});

describe('workflow n8n: struktura pliku do importu', () => {
  it('webhook POST z odpowiedzią z węzła Respond; wszystkie połączenia wskazują istniejące węzły', () => {
    const webhook = workflow.nodes.find((n) => n.type === 'n8n-nodes-base.webhook')!;
    expect(webhook.parameters).toMatchObject({ httpMethod: 'POST', path: 'atai-followup', responseMode: 'responseNode' });
    const names = new Set(workflow.nodes.map((n) => n.name));
    for (const [from, { main }] of Object.entries(workflow.connections)) {
      expect(names.has(from), from).toBe(true);
      for (const branch of main) for (const target of branch) expect(names.has(target.node), target.node).toBe(true);
    }
    expect(workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook')).toHaveLength(2);
  });

  it('plik nie zawiera sekretów ani danych dostępowych (sekret tylko ze zmiennej ATAI_WEBHOOK_SECRET)', () => {
    const raw = Object.values(files)[0]!;
    expect(raw).toContain('$env.ATAI_WEBHOOK_SECRET');
    expect(raw).not.toMatch(/[0-9a-f]{32,}/i);
    expect(raw).not.toMatch(/sekret-do-podpisu/);
    expect(JSON.stringify(workflow.nodes.map((n) => (n as { credentials?: unknown }).credentials))).not.toMatch(/"id"/);
  });
});
