/**
 * E2E: powiadomienia dla konsultanta (outbox → webhook n8n). Prawdziwe Edge Functions i baza; odbiorcą jest odbiornik
 * w teście (src/e2e/webhook.ts), który weryfikuje podpis tak jak workflow n8n. Wymaga w supabase/functions/.env:
 * N8N_WEBHOOK_URL=http://host.docker.internal:<port>/hook i N8N_WEBHOOK_SECRET (patrz scripts/e2e.mjs i README) —
 * bez tego cały plik jest pomijany.
 *
 * Odbiornik i profil konsultantki Oli są współdzielone z równolegle działającymi plikami e2e, więc każdy scenariusz
 * filtruje żądania po identyfikatorze własnej sesji.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, callFn, deleteMailsTo, fillExample, MAREK, newSession, OLA, reveal, sleep, unique, type TestSession } from './helpers';
import { startWebhookReceiver, type ReceivedWebhook, type WebhookReceiver } from './webhook';

const PORT = Number(process.env.E2E_WEBHOOK_PORT ?? 0);
const SECRET = process.env.E2E_WEBHOOK_SECRET ?? '';
const TARGET = '123456789';
const emails: string[] = [];

let receiver: WebhookReceiver;

/** Sesja po CTA (zamrożony stan, firma, wynik odsłonięty) dla wskazanego konsultanta. */
async function afterCta(label: string, consultantId: string = OLA): Promise<TestSession> {
  const session = await newSession(label, consultantId);
  expect((await callFn('lookup-company', { token: session.token, nip: '5261040567' })).status).toBe(200);
  await fillExample(session.token);
  await reveal(session.id, 10);
  const email = `rozmowca-${unique()}@e2e.test`;
  emails.push(email);
  expect((await callFn('request-calculation', { token: session.token, email })).status).toBe(200);
  return session;
}

const visit = (token: string) => callFn('guest-session', { action: 'get', token, visit: true });
const patch = (token: string, fields: Record<string, number>) => callFn('guest-session', { action: 'patch', token, patch: fields });

const outbox = async (sessionId: string) => {
  const { data, error } = await admin.from('notification_outbox').select('kind, status, attempts, new_visit').eq('session_id', sessionId).order('id');
  if (error) throw error;
  return data ?? [];
};

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`Warunek nie został spełniony w ${timeoutMs} ms (ostatnia wartość: ${JSON.stringify(value)})`);
    await sleep(100);
  }
}

const kinds = (list: ReceivedWebhook[]) => list.map((r) => r.payload.kind);

describe.skipIf(!PORT || !SECRET)('powiadomienia dla konsultanta', () => {
  beforeAll(async () => {
    receiver = await startWebhookReceiver(PORT, SECRET);
    await admin.from('profiles').update({ notify_channel: 'telegram', notify_target: TARGET }).eq('user_id', OLA);
    await admin.from('profiles').update({ notify_channel: null, notify_target: null }).eq('user_id', MAREK);
  });

  afterAll(async () => {
    await admin.from('profiles').update({ notify_channel: null, notify_target: null }).eq('user_id', OLA);
    await receiver?.close();
    await deleteMailsTo(emails);
  });

  describe('jedna sesja: wizyta, zmiany, przywrócenie, przerwa', () => {
    let session: TestSession;

    beforeAll(async () => {
      session = await afterCta('ntf-flow');
    });

    it('otwarcie strony po CTA → jeden podpisany alert „klient wrócił”, tylko minimum + link', async () => {
      expect((await visit(session.token)).status).toBe(200);
      const hit = await receiver.waitFor((r) => r.payload?.sessionUrl?.includes(session.id));

      expect(hit.signatureOk).toBe(true);
      expect(hit.fresh).toBe(true);
      expect(hit.headers['x-event-id']).toBe(hit.payload.eventId);
      expect(hit.headers['content-type']).toContain('application/json');
      expect(hit.payload).toMatchObject({
        kind: 'client_returned',
        newVisit: false,
        organization: 'MITAX Consulting sp. z o.o.',
        consultantName: 'Ola Konsultant',
        changedFields: null,
        channel: { type: 'telegram', target: TARGET },
      });
      expect(hit.payload.sessionUrl).toMatch(new RegExp(`/session/${session.id}/follow-up$`));
      expect(hit.payload.message).toContain('Klient wrócił');
      expect(Object.keys(hit.payload).sort()).toEqual(
        ['changedFields', 'channel', 'consultantName', 'eventId', 'kind', 'message', 'newVisit', 'occurredAt', 'organization', 'sessionUrl'],
      );

      // nic z leada ani z tokenu rozmówcy nie wychodzi do n8n
      const raw = hit.rawBody.toLowerCase();
      for (const forbidden of ['5261040567', 't-mobile', '@e2e.test', session.token.toLowerCase(), 'przychod', 'koszty', 'nip']) {
        expect(raw, forbidden).not.toContain(forbidden);
      }

      await sleep(1_200);
      expect(receiver.forSession(session.id)).toHaveLength(1);
      expect((await outbox(session.id)).map((o) => `${o.kind}:${o.status}`)).toEqual(['client_returned:sent']);
    });

    it('zmiany klienta w wizycie → dokładnie jeden alert „klient zmienił dane”', async () => {
      await patch(session.token, { prac: 12, koszty: 1_800_000 });
      const hit = await receiver.waitFor((r) => r.payload?.sessionUrl?.includes(session.id) && r.payload.kind === 'client_changed');
      expect(hit.signatureOk).toBe(true);
      expect(hit.payload).toMatchObject({ newVisit: false });
      expect(hit.payload.changedFields).toBeGreaterThanOrEqual(1);
      expect(hit.payload.message).toContain('zmienił dane');

      await patch(session.token, { prac: 13 });
      await patch(session.token, { kh: 150 });
      await sleep(1_500);
      expect(kinds(receiver.forSession(session.id))).toEqual(['client_returned', 'client_changed']);
    });

    it('„Wróć do stanu z rozmowy” w tej samej wizycie nie dodaje alertu', async () => {
      expect((await callFn('guest-session', { action: 'restore', token: session.token })).status).toBe(200);
      await sleep(1_500);
      expect(kinds(receiver.forSession(session.id))).toEqual(['client_returned', 'client_changed']);
    });

    it('po 31 min ciszy kolejne otwarcie to nowa wizyta z własnym alertem (inny eventId)', async () => {
      await admin
        .from('session_visits')
        .update({ last_activity_at: new Date(Date.now() - 31 * 60_000).toISOString() })
        .eq('session_id', session.id);
      expect((await visit(session.token)).status).toBe(200);
      await until(async () => receiver.forSession(session.id).length, (n) => n === 3);

      const alerts = receiver.forSession(session.id);
      expect(kinds(alerts)).toEqual(['client_returned', 'client_changed', 'client_returned']);
      expect(new Set(alerts.map((a) => a.payload.eventId)).size).toBe(3);
      const { count } = await admin.from('session_visits').select('id', { count: 'exact', head: true }).eq('session_id', session.id);
      expect(count).toBe(2);
    });
  });

  it('wizyta rozpoczęta zmianą (strona była otwarta): jeden alert „wrócił i zmienił”, bez osobnego „wrócił”', async () => {
    const session = await afterCta('ntf-newvisit');
    await patch(session.token, { prac: 11 });
    const hit = await receiver.waitFor((r) => r.payload?.sessionUrl?.includes(session.id));
    expect(hit.payload).toMatchObject({ kind: 'client_changed', newVisit: true });
    expect(hit.payload.message).toContain('wrócił do kalkulacji i zmienił dane');
    await sleep(1_000);
    expect(kinds(receiver.forSession(session.id))).toEqual(['client_changed']);
  });

  it('konsultant bez adresata: wpis jest pominięty (skipped), nic nie wychodzi do n8n', async () => {
    const session = await afterCta('ntf-noaddr', MAREK);
    expect((await visit(session.token)).status).toBe(200);
    const rows = await until(() => outbox(session.id), (r) => r.length === 1 && r[0]!.status !== 'pending');
    expect(rows.map((r) => `${r.kind}:${r.status}`)).toEqual(['client_returned:skipped']);
    await sleep(1_000);
    expect(receiver.forSession(session.id)).toEqual([]);
  });

  it('awaria odbiornika nie psuje odpowiedzi klientowi; alert wraca przy kolejnym żądaniu (ten sam eventId)', async () => {
    const session = await afterCta('ntf-retry');
    receiver.next(session.id, { status: 500 });

    const started = Date.now();
    const response = await visit(session.token);
    expect(response.status).toBe(200);
    expect(response.body.view.followUp).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);

    await receiver.waitFor((r) => r.payload?.sessionUrl?.includes(session.id));
    const pending = await until(() => outbox(session.id), (r) => r[0]?.attempts === 1);
    expect(pending[0]).toMatchObject({ kind: 'client_returned', status: 'pending' });

    // kolejne żądanie klienta „pcha” zaległy wpis; odbiornik działa już normalnie
    await patch(session.token, { prac: 10 });
    await until(async () => receiver.forSession(session.id).filter((r) => r.payload.kind === 'client_returned').length, (n) => n === 2);
    const returned = receiver.forSession(session.id).filter((r) => r.payload.kind === 'client_returned');
    expect(returned.map((r) => r.respondedWith)).toEqual([500, 200]);
    expect(returned[0]!.payload.eventId).toBe(returned[1]!.payload.eventId);
    expect(returned.every((r) => r.signatureOk)).toBe(true);

    const rows = await until(() => outbox(session.id), (r) => r.find((x) => x.kind === 'client_returned')?.status === 'sent');
    expect(rows.find((x) => x.kind === 'client_returned')!.attempts).toBe(2);
  });

  it('wolny odbiornik nie opóźnia odpowiedzi dla klienta (dostarczanie w tle)', async () => {
    const session = await afterCta('ntf-slow');
    receiver.next(session.id, { delayMs: 2_500 });

    const started = Date.now();
    expect((await visit(session.token)).status).toBe(200);
    expect(Date.now() - started).toBeLessThan(2_000);

    await receiver.waitFor((r) => r.payload?.sessionUrl?.includes(session.id));
    await until(() => outbox(session.id), (r) => r[0]?.status === 'sent', 15_000);
  });

  it('równoległe otwarcia z kilku kart: jedna wizyta i jeden alert', async () => {
    const session = await afterCta('ntf-race');
    const responses = await Promise.all([1, 2, 3, 4].map(() => visit(session.token)));
    expect(responses.every((r) => r.status === 200)).toBe(true);

    await receiver.waitFor((r) => r.payload?.sessionUrl?.includes(session.id));
    await sleep(1_500);
    expect(receiver.forSession(session.id)).toHaveLength(1);
    const { count } = await admin.from('session_visits').select('id', { count: 'exact', head: true }).eq('session_id', session.id);
    expect(count).toBe(1);
    expect((await outbox(session.id)).map((o) => o.kind)).toEqual(['client_returned']);
  });

  it('przed zamrożeniem stanu rozmowa na żywo nie generuje żadnych alertów', async () => {
    const session = await newSession('ntf-before');
    await fillExample(session.token);
    await reveal(session.id);
    await visit(session.token);
    await patch(session.token, { prac: 7 });
    await sleep(1_200);
    expect(receiver.forSession(session.id)).toEqual([]);
    expect(await outbox(session.id)).toEqual([]);
  });
});
