import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { NotifyConfig } from './config.ts';
import { dispatchNotifications, type DispatchDeps, type Outcome, type WebhookRequest } from './dispatch.ts';

const SECRET = 'sekret-do-podpisu-1234';
const CONFIG: NotifyConfig = { webhookUrl: 'https://n8n.example.com/webhook/abc', secret: SECRET, appBaseUrl: 'https://atai.mitax.pl' };
const SESSION = '2417ec05-8f82-4a86-9313-1d34c7063f65';

const rawRow = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'client_returned',
  new_visit: false,
  created_at: '2026-11-11T17:52:00.000Z',
  session_id: SESSION,
  organization: 'MITAX',
  consultant_name: 'Ola',
  notify_channel: 'telegram',
  notify_target: '123456789',
  changed_fields: null,
  ...over,
});

function setup(opts: { rows?: unknown; statuses?: (number | Error)[]; claimFails?: boolean; finishFails?: boolean } = {}) {
  const sent: WebhookRequest[] = [];
  const finished: [number, Outcome][] = [];
  const logs: string[] = [];
  const statuses = [...(opts.statuses ?? [])];
  const deps: DispatchDeps = {
    config: CONFIG,
    claim: async () => {
      if (opts.claimFails) throw new Error('baza niedostępna: sekret-do-podpisu-1234');
      return opts.rows ?? [];
    },
    finish: async (id, outcome) => {
      if (opts.finishFails) throw new Error('nie działa');
      finished.push([id, outcome]);
    },
    send: async (request) => {
      sent.push(request);
      const next = statuses.shift() ?? 200;
      if (next instanceof Error) throw next;
      return next;
    },
    now: () => 1_762_860_000_000,
    log: (m) => logs.push(m),
  };
  return { deps, sent, finished, logs };
}

describe('dispatchNotifications', () => {
  it('wysyła podpisany webhook i zamyka wpis jako wysłany', async () => {
    const { deps, sent, finished } = setup({ rows: [rawRow(1)] });
    const summary = await dispatchNotifications(deps);

    expect(summary).toEqual({ sent: 1, skipped: 0, retried: 0, invalid: 0 });
    expect(finished).toEqual([[1, 'sent']]);
    expect(sent).toHaveLength(1);
    const req = sent[0]!;
    expect(req.url).toBe(CONFIG.webhookUrl);
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(req.headers['X-Event-Id']).toBe('ntf-1');
    expect(req.headers['X-Timestamp']).toBe('1762860000');
    // odbiorca weryfikuje podpis tak samo: HMAC(sekret, `${timestamp}.${body}`)
    const expected = `sha256=${createHmac('sha256', SECRET).update(`1762860000.${req.body}`).digest('hex')}`;
    expect(req.headers['X-Signature']).toBe(expected);
    expect(JSON.parse(req.body)).toMatchObject({ eventId: 'ntf-1', kind: 'client_returned', channel: { type: 'telegram', target: '123456789' } });
  });

  it('kilka wpisów: każdy osobno, w kolejności', async () => {
    const { deps, finished } = setup({ rows: [rawRow(1), rawRow(2, { kind: 'client_changed', changed_fields: 2 })] });
    expect((await dispatchNotifications(deps)).sent).toBe(2);
    expect(finished).toEqual([[1, 'sent'], [2, 'sent']]);
  });

  it('konsultant bez adresata: wpis pominięty, nic nie jest wysyłane', async () => {
    const { deps, sent, finished } = setup({ rows: [rawRow(1, { notify_channel: null, notify_target: null })] });
    expect(await dispatchNotifications(deps)).toEqual({ sent: 0, skipped: 1, retried: 0, invalid: 0 });
    expect(sent).toEqual([]);
    expect(finished).toEqual([[1, 'skipped']]);
  });

  it('odpowiedź inna niż 2xx (4xx, 5xx, 3xx) = ponowienie, nie „wysłano”', async () => {
    for (const status of [301, 400, 401, 404, 429, 500, 503]) {
      const { deps, finished } = setup({ rows: [rawRow(1)], statuses: [status] });
      expect((await dispatchNotifications(deps)).retried, String(status)).toBe(1);
      expect(finished).toEqual([[1, 'retry']]);
    }
    for (const status of [200, 201, 204]) {
      const { deps, finished } = setup({ rows: [rawRow(1)], statuses: [status] });
      await dispatchNotifications(deps);
      expect(finished, String(status)).toEqual([[1, 'sent']]);
    }
  });

  it('awaria sieci lub przekroczony czas = ponowienie; kolejne wpisy są obsługiwane dalej', async () => {
    const { deps, finished } = setup({ rows: [rawRow(1), rawRow(2)], statuses: [new Error('timeout'), 200] });
    expect(await dispatchNotifications(deps)).toEqual({ sent: 1, skipped: 0, retried: 1, invalid: 0 });
    expect(finished).toEqual([[1, 'retry'], [2, 'sent']]);
  });

  it('niepoprawne wiersze są pomijane i zgłoszone w logu, reszta idzie dalej', async () => {
    const { deps, finished, logs } = setup({ rows: [{ id: 'x' }, rawRow(2)] });
    expect(await dispatchNotifications(deps)).toEqual({ sent: 1, skipped: 0, retried: 0, invalid: 1 });
    expect(finished).toEqual([[2, 'sent']]);
    expect(logs.some((l) => l.includes('1 wpisów'))).toBe(true);
  });

  it('awaria odbioru z bazy: nic nie wysyłamy i nie rzucamy wyjątku', async () => {
    const { deps, sent } = setup({ claimFails: true });
    expect(await dispatchNotifications(deps)).toEqual({ sent: 0, skipped: 0, retried: 0, invalid: 0 });
    expect(sent).toEqual([]);
  });

  it('awaria zamknięcia wpisu nie przerywa pętli (wpis wróci po 60 s; odbiorca deduplikuje po X-Event-Id)', async () => {
    const { deps, sent } = setup({ rows: [rawRow(1), rawRow(2)], finishFails: true });
    expect((await dispatchNotifications(deps)).sent).toBe(2);
    expect(sent).toHaveLength(2);
  });

  it('pusty outbox: nic się nie dzieje', async () => {
    const { deps, sent, finished } = setup({ rows: [] });
    expect(await dispatchNotifications(deps)).toEqual({ sent: 0, skipped: 0, retried: 0, invalid: 0 });
    expect(sent).toEqual([]);
    expect(finished).toEqual([]);
  });

  it('logi nie zawierają sekretu, adresu webhooka, adresata ani treści alertu', async () => {
    const { deps, logs } = setup({ rows: [rawRow(1), { zepsuty: true }], statuses: [new Error('połączenie z https://n8n.example.com/webhook/abc odrzucone')] });
    await dispatchNotifications(deps);
    const all = logs.join('\n');
    for (const secret of [SECRET, 'n8n.example.com', '123456789', 'MITAX', 'Ola']) expect(all, secret).not.toContain(secret);
    const failing = setup({ claimFails: true });
    await dispatchNotifications(failing.deps);
    expect(failing.logs.join('\n')).not.toContain(SECRET);
  });
});
