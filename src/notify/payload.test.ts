import { describe, expect, it } from 'vitest';
import { buildNotification, parseClaimed, type ClaimedNotification } from './payload.ts';

const SESSION = '2417ec05-8f82-4a86-9313-1d34c7063f65';
const raw = (over: Record<string, unknown> = {}) => ({
  id: 7,
  kind: 'client_returned',
  new_visit: false,
  created_at: '2026-11-11T17:52:00.000Z',
  session_id: SESSION,
  organization: 'MITAX Consulting sp. z o.o.',
  consultant_name: 'Ola Konsultant',
  notify_channel: 'telegram',
  notify_target: '123456789',
  changed_fields: null,
  ...over,
});
const row = (over: Partial<ClaimedNotification> = {}): ClaimedNotification => ({
  id: 7,
  kind: 'client_returned',
  newVisit: false,
  createdAt: '2026-11-11T17:52:00.000Z',
  sessionId: SESSION,
  organization: 'MITAX Consulting sp. z o.o.',
  consultantName: 'Ola Konsultant',
  channel: 'telegram',
  target: '123456789',
  changedFields: null,
  ...over,
});

describe('parseClaimed', () => {
  it('poprawny wiersz z bazy', () => {
    expect(parseClaimed([raw()])).toEqual({ rows: [row()], invalid: 0 });
  });
  it('brak adresata i brak imienia są dozwolone', () => {
    const { rows } = parseClaimed([raw({ notify_channel: null, notify_target: null, consultant_name: null })]);
    expect(rows[0]).toMatchObject({ channel: null, target: null, consultantName: null });
  });
  it('liczba zmienionych pól', () => {
    expect(parseClaimed([raw({ kind: 'client_changed', changed_fields: 3 })]).rows[0]!.changedFields).toBe(3);
  });
  it('niepoprawne wiersze są pomijane i policzone (nie wywracają reszty)', () => {
    const bad = [
      null, 'x', [], {},
      raw({ id: 0 }), raw({ id: '7' }), raw({ id: 1.5 }),
      raw({ kind: 'inny' }), raw({ new_visit: 'nie' }),
      raw({ created_at: 'wczoraj' }), raw({ session_id: 'nie-uuid' }), raw({ organization: '' }),
      raw({ consultant_name: 5 }), raw({ changed_fields: -1 }), raw({ changed_fields: 'x' }),
      raw({ notify_channel: 'sms' }), raw({ notify_channel: 'telegram', notify_target: null }),
      raw({ notify_channel: null, notify_target: '123456789' }), raw({ notify_target: 123456789 }),
    ];
    const r = parseClaimed([...bad, raw({ id: 8 })]);
    expect(r.rows.map((x) => x.id)).toEqual([8]);
    expect(r.invalid).toBe(bad.length);
  });
  it('wynik niebędący tablicą → pusto', () => {
    for (const v of [null, undefined, {}, 'x', 5]) expect(parseClaimed(v)).toEqual({ rows: [], invalid: 0 });
  });
});

describe('buildNotification', () => {
  it('„klient wrócił”: link do widoku follow-up, adresat i gotowy tekst', () => {
    expect(buildNotification(row(), 'https://atai.mitax.pl')).toEqual({
      eventId: 'ntf-7',
      kind: 'client_returned',
      newVisit: false,
      occurredAt: '2026-11-11T17:52:00.000Z',
      organization: 'MITAX Consulting sp. z o.o.',
      consultantName: 'Ola Konsultant',
      sessionUrl: `https://atai.mitax.pl/session/${SESSION}/follow-up`,
      changedFields: null,
      message: 'MITAX Consulting sp. z o.o.: Klient wrócił do kalkulacji z rozmowy. Zobacz, co ogląda.',
      channel: { type: 'telegram', target: '123456789' },
    });
  });

  it('„klient zmienił dane”: liczba pól w tekście; wizyta rozpoczęta zmianą mówi „wrócił i zmienił”', () => {
    const changed = buildNotification(row({ kind: 'client_changed', changedFields: 3 }), 'https://x.pl')!;
    expect(changed.message).toBe('MITAX Consulting sp. z o.o.: Klient zmienił dane w kalkulacji (zmienione pola: 3).');
    expect(changed.changedFields).toBe(3);
    const both = buildNotification(row({ kind: 'client_changed', newVisit: true, changedFields: 2 }), 'https://x.pl')!;
    expect(both.message).toContain('wrócił do kalkulacji i zmienił dane (zmienione pola: 2)');
    expect(buildNotification(row({ kind: 'client_changed' }), 'https://x.pl')!.message).toBe(
      'MITAX Consulting sp. z o.o.: Klient zmienił dane w kalkulacji.',
    );
  });

  it('końcowe ukośniki w adresie aplikacji nie dublują się w linku', () => {
    expect(buildNotification(row(), 'https://atai.mitax.pl//')!.sessionUrl).toBe(`https://atai.mitax.pl/session/${SESSION}/follow-up`);
  });

  it('bez adresata → null (wpis zostanie pominięty)', () => {
    expect(buildNotification(row({ channel: null, target: null }), 'https://x.pl')).toBeNull();
  });

  it('MINIMUM + LINK: dokładny zestaw pól, bez danych leada (firma, NIP, e-mail, wartości)', () => {
    const p = buildNotification(row({ kind: 'client_changed', changedFields: 2 }), 'https://x.pl')!;
    expect(Object.keys(p).sort()).toEqual(
      ['changedFields', 'channel', 'consultantName', 'eventId', 'kind', 'message', 'newVisit', 'occurredAt', 'organization', 'sessionUrl'],
    );
    const json = JSON.stringify(p).toLowerCase();
    for (const forbidden of ['nip', 'regon', 'email', 'e-mail', 'company', 'firma', 'inputs', 'przychod', 'koszty', 'token']) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    // w linku jest identyfikator sesji (wymaga logowania konsultanta), a nie token rozmówcy
    expect(p.sessionUrl).toContain(SESSION);
  });
});
