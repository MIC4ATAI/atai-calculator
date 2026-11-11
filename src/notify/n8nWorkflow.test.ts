/**
 * Kontrakt nadawca ↔ workflow n8n (docs/n8n-followup-workflow.json).
 *
 * Workflow liczy podpis wbudowanym węzłem Crypto (HMAC-SHA256), a węzeł Code tylko go porównuje, sprawdza okno czasowe,
 * duplikaty i zabezpieczenie przed sekretem zastępczym. Ten test wykonuje kod z węzła Code na prawdziwych ładunkach i podpisach
 * z src/notify, a pracę węzła Crypto emuluje, licząc HMAC według WYRAŻENIA zapisanego w samym szablonie. Dzięki temu
 * pilnuje zgodności trzech rzeczy naraz: tego, co podpisuje kalkulator, tego, co liczy n8n, i tego, co porównuje kod.
 * Nie uruchamia n8n; pełne próby na żywej instancji opisuje docs/n8n-followup.md.
 */
import * as nodeCrypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildNotification, type ClaimedNotification } from './payload.ts';
import { signPayload } from './signature.ts';

const files = import.meta.glob('../../docs/n8n-followup-workflow.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const RAW = Object.values(files)[0]!;

interface WorkflowNode {
  name: string;
  type: string;
  typeVersion: number;
  parameters: Record<string, unknown>;
  credentials?: unknown;
}
const workflow = JSON.parse(RAW) as { nodes: WorkflowNode[]; connections: Record<string, { main: { node: string }[][] }> };

const byType = (type: string): WorkflowNode => workflow.nodes.find((n) => n.type === type)!;
const cryptoNode = byType('n8n-nodes-base.crypto');
const codeNode = byType('n8n-nodes-base.code');

const SECRET = 'sekret-do-podpisu-1234'; // >= 16 znaków (inaczej zabezpieczenie odrzuci żądanie)
const PLACEHOLDER = 'WKLEJ_SEKRET_TUTAJ';
const NOW = 1_762_860_000_000;

const row: ClaimedNotification = {
  id: 9,
  kind: 'client_changed',
  newVisit: false,
  createdAt: '2026-11-11T17:52:00.000Z',
  sessionId: '2417ec05-8f82-4a86-9313-1d34c7063f65',
  organization: 'MITAX & Co <sp. z o.o.>',
  consultantName: 'Ola Konsultant',
  channel: 'telegram',
  target: '123456789',
  changedFields: 2,
};

type Item = { headers: Record<string, string>; body: unknown };
type Out = { json: { send: boolean; status: number; reason?: string; chatId?: string; text?: string } }[];

/** Wyrażenie `value` z węzła Crypto zapisane w szablonie, wykonane jak w n8n (`$json` = element z Webhooka). */
function cryptoValue(json: Item): string {
  const expression = String(cryptoNode.parameters.value).replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  return new Function('$json', `return (${expression});`)(json) as string;
}

/** Emulacja węzła Crypto (action=hmac, SHA256, hex) według parametrów z szablonu. */
function hmacNode(json: Item, secret: string): Item & { expectedHmac: string } {
  expect(cryptoNode.parameters).toMatchObject({ action: 'hmac', type: 'SHA256', encoding: 'hex', dataPropertyName: 'expectedHmac' });
  // Pusty sekret: nodeCrypto odmawia pustego klucza, więc emulujemy to jako brak HMAC (kod i tak odrzuci żądanie przed porównaniem).
  const expectedHmac = secret === '' ? '' : nodeCrypto.createHmac('sha256', secret).update(cryptoValue(json)).digest('hex');
  return { ...json, expectedHmac };
}

const run = new Function('$input', '$node', '$getWorkflowStaticData', 'Date', String(codeNode.parameters.jsCode)) as (
  input: { first: () => { json: unknown } },
  node: Record<string, { parameter: { secret: unknown } }>,
  staticData: (scope: string) => Record<string, unknown>,
  date: { now: () => number },
) => Out;

/**
 * Wykonuje kod węzła tak jak n8n: najpierw Crypto liczy HMAC z `nodeSecret` (sekret wpisany w węźle), potem kod porównuje.
 * `nodeSecret` to to, co jest w polu Secret w n8n; kalkulator podpisuje własnym `N8N_WEBHOOK_SECRET` (w teście SECRET).
 */
function execute(item: Item, opts: { nodeSecret?: unknown; store?: Record<string, unknown>; now?: number } = {}): Out {
  const nodeSecret = 'nodeSecret' in opts ? opts.nodeSecret : SECRET;
  const withHmac = hmacNode(item, String(nodeSecret));
  return run(
    { first: () => ({ json: withHmac }) },
    { [cryptoNode.name]: { parameter: { secret: nodeSecret } } },
    () => opts.store ?? {},
    { now: () => opts.now ?? NOW },
  );
}

/** Żądanie dokładnie tak, jak wysyła je nadawca (dispatch.ts): ciało = JSON.stringify(payload), podpis z src/notify. */
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

describe('workflow n8n: podpis liczony węzłem Crypto zgadza się z tym, co podpisuje kalkulator', () => {
  it('wyrażenie z szablonu daje dokładnie ciąg `<znacznik>.<treść>`, który podpisuje src/notify/signature.ts', async () => {
    const req = await signedRequest();
    const timestamp = req.headers['x-timestamp']!;
    const senderBody = JSON.stringify(req.body); // treść po stronie nadawcy = JSON.stringify(payload); n8n parsuje i serializuje ją ponownie
    expect(cryptoValue(req)).toBe(`${timestamp}.${senderBody}`);
    expect('sha256=' + hmacNode(req, SECRET).expectedHmac).toBe(req.headers['x-signature']);
  });

  it('brak znacznika czasu lub ciała nie wywraca wyrażenia (kod odrzuci takie żądanie)', () => {
    expect(() => cryptoValue({ headers: {}, body: undefined })).not.toThrow();
  });
});

describe('workflow n8n: kod węzła „Sprawdź podpis i duplikaty”', () => {
  it('poprawne żądanie od nadawcy: wysyłamy alert do adresata, tekst escapowany pod HTML Telegrama, bez cichych zmian w treści', async () => {
    const [out] = execute(await signedRequest());
    expect(out!.json).toMatchObject({ send: true, status: 200, chatId: '123456789' });
    expect(out!.json.text).toBe(
      'MITAX &amp; Co &lt;sp. z o.o.&gt;: Klient zmienił dane w kalkulacji (zmienione pola: 2).\nhttps://atai.mitax.pl/session/2417ec05-8f82-4a86-9313-1d34c7063f65/follow-up',
    );
  });

  it('zły sekret nadawcy, zmieniona treść i uszkodzony lub brakujący podpis → 401 „zly_podpis”', async () => {
    expect(execute(await signedRequest({ secret: 'inny-sekret-do-podpisu' }))[0]!.json).toMatchObject({ send: false, status: 401, reason: 'zly_podpis' });

    const tampered = await signedRequest();
    (tampered.body as { channel: { target: string } }).channel.target = '999999999';
    expect(execute(tampered)[0]!.json).toMatchObject({ status: 401, reason: 'zly_podpis' });

    for (const signature of ['sha256=zly', '', 'sha256=' + 'a'.repeat(64), 'sha256=' + 'a'.repeat(63)]) {
      const broken = await signedRequest();
      broken.headers['x-signature'] = signature;
      expect(execute(broken)[0]!.json, signature).toMatchObject({ status: 401, reason: 'zly_podpis' });
    }

    const missing = await signedRequest();
    delete missing.headers['x-signature'];
    expect(execute(missing)[0]!.json).toMatchObject({ status: 401, reason: 'zly_podpis' });
  });

  it('podpis o innej długości niż oczekiwany (także prefiks poprawny, reszta urwana) jest odrzucany', async () => {
    const req = await signedRequest();
    req.headers['x-signature'] = req.headers['x-signature']!.slice(0, -1);
    expect(execute(req)[0]!.json).toMatchObject({ status: 401, reason: 'zly_podpis' });
    const longer = await signedRequest();
    longer.headers['x-signature'] = longer.headers['x-signature'] + '0';
    expect(execute(longer)[0]!.json).toMatchObject({ status: 401, reason: 'zly_podpis' });
  });

  it('znacznik czasu: tylko cyfry i nie starszy niż 5 minut (ochrona przed powtórzeniem)', async () => {
    const nowSec = Math.floor(NOW / 1000);
    expect(execute(await signedRequest({ timestamp: String(nowSec - 301) }))[0]!.json).toMatchObject({ status: 401, reason: 'przeterminowane' });
    expect(execute(await signedRequest({ timestamp: String(nowSec - 299) }))[0]!.json.send).toBe(true);
    expect(execute(await signedRequest({ timestamp: String(nowSec + 400) }))[0]!.json.reason).toBe('przeterminowane');

    const bad = await signedRequest();
    bad.headers['x-timestamp'] = '1.2';
    expect(execute(bad)[0]!.json).toMatchObject({ status: 401, reason: 'zly_znacznik_czasu' });
    delete bad.headers['x-timestamp'];
    expect(execute(bad)[0]!.json).toMatchObject({ status: 401, reason: 'zly_znacznik_czasu' });
  });

  it('zabezpieczenie: sekret zastępczy lub krótszy niż 16 znaków w węźle Crypto → 500, nawet przy „poprawnym” podpisie', async () => {
    // Znacznik jest publiczny (jest w repozytorium i w n8n), więc podpis policzony z nim nie może przejść.
    const forgedWithPlaceholder = await signedRequest({ secret: PLACEHOLDER });
    expect(execute(forgedWithPlaceholder, { nodeSecret: PLACEHOLDER })[0]!.json).toMatchObject({ send: false, status: 500, reason: 'sekret_nie_ustawiony' });

    for (const short of ['krotki', 'a'.repeat(15)]) {
      expect(execute(await signedRequest({ secret: short }), { nodeSecret: short })[0]!.json, JSON.stringify(short)).toMatchObject({
        status: 500,
        reason: 'sekret_nie_ustawiony',
      });
    }
    // pusty sekret w węźle (nadawca podpisuje poprawnym sekretem)
    expect(execute(await signedRequest(), { nodeSecret: '' })[0]!.json).toMatchObject({ status: 500, reason: 'sekret_nie_ustawiony' });
    expect(execute(await signedRequest({ secret: 'a'.repeat(16) }), { nodeSecret: 'a'.repeat(16) })[0]!.json.send).toBe(true);
    // brak wartości (pole puste lub nieustawione)
    expect(execute(await signedRequest(), { nodeSecret: undefined })[0]!.json).toMatchObject({ status: 500, reason: 'sekret_nie_ustawiony' });
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

  it('odrzucone żądanie nie zapisuje niczego w pamięci deduplikacji', async () => {
    const store: Record<string, unknown> = {};
    execute(await signedRequest({ secret: 'inny-sekret-do-podpisu' }), { store });
    expect(store.seen).toBeUndefined();
  });
});

describe('workflow n8n: struktura szablonu', () => {
  it('webhook POST z odpowiedzią z węzła Respond; kolejność: Webhook → Crypto → Code → If; wszystkie połączenia wskazują istniejące węzły', () => {
    const webhook = byType('n8n-nodes-base.webhook');
    expect(webhook.parameters).toMatchObject({ httpMethod: 'POST', path: 'atai-followup', responseMode: 'responseNode' });
    const names = new Set(workflow.nodes.map((n) => n.name));
    for (const [from, { main }] of Object.entries(workflow.connections)) {
      expect(names.has(from), from).toBe(true);
      for (const branch of main) for (const target of branch) expect(names.has(target.node), target.node).toBe(true);
    }
    const next = (name: string) => workflow.connections[name]!.main[0]!.map((t) => t.node);
    expect(next(webhook.name)).toEqual([cryptoNode.name]);
    expect(next(cryptoNode.name)).toEqual([codeNode.name]);
    expect(next(codeNode.name)).toEqual(['Czy wysłać alert?']);
    expect(workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook')).toHaveLength(2);
  });

  it('podpis liczy wbudowany węzeł Crypto, a kod nie wymaga niczego od serwera n8n (bez require i $env)', () => {
    expect(cryptoNode.typeVersion).toBe(1); // wersja 2 węzła Crypto nie ma HMAC
    const code = String(codeNode.parameters.jsCode);
    expect(code).not.toMatch(/require\s*\(/);
    expect(code).not.toMatch(/\$env[.[]/);
  });

  it('sekretem w szablonie jest tylko znacznik do uzupełnienia; plik nie zawiera sekretów, kluczy ani poświadczeń z instancji', () => {
    expect(cryptoNode.parameters.secret).toBe(PLACEHOLDER);
    expect(RAW).not.toMatch(/[0-9a-f]{32,}/i);
    expect(RAW).not.toMatch(/sekret-do-podpisu|test-secret/);
    expect(JSON.stringify(workflow.nodes.map((n) => n.credentials ?? null))).not.toMatch(/"id"/);
  });
});
