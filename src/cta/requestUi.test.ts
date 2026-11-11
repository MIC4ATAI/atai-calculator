import { describe, expect, it } from 'vitest';
import { buildLeadInfo } from './leadInfo';
import { REQUEST_ERROR_MESSAGES, requestErrorKind, type RequestErrorKind } from './requestErrors';

describe('requestErrorKind', () => {
  it.each<[number | null, string | null, RequestErrorKind]>([
    [409, 'not_revealed', 'not_revealed'],
    [409, 'no_company', 'no_company'],
    [409, 'incomplete_data', 'incomplete_data'],
    [409, 'email_locked', 'email_locked'],
    [429, 'limit_reached', 'limit_reached'],
    [400, 'invalid_email', 'invalid_email'],
    [502, 'send_failed', 'send_failed'],
    [409, 'state_changed', 'send_failed'],
    [404, 'not_found', 'session_gone'],
    [500, 'server_error', 'unavailable'],
    [400, 'bad_request', 'unavailable'],
    [null, null, 'unavailable'],
  ])('status %s, kod %s → %s', (status, code, expected) => {
    expect(requestErrorKind(status, code)).toBe(expected);
  });

  it('każdy rodzaj błędu ma komunikat dla rozmówcy, bez żargonu technicznego', () => {
    for (const kind of Object.keys(REQUEST_ERROR_MESSAGES) as RequestErrorKind[]) {
      expect(REQUEST_ERROR_MESSAGES[kind].length).toBeGreaterThan(10);
      expect(REQUEST_ERROR_MESSAGES[kind]).not.toMatch(/MailerSend|Mailpit|RPC|AT00|SQL|token|supabase|502|HTTP/i);
    }
  });
});

describe('buildLeadInfo (prezenter)', () => {
  const lead = (id: string, email: string, created_at: string) => ({ id, email, created_at });
  const delivery = (id: number, lead_id: string, status: string, error: string | null = null, created_at = '2026-11-11T12:00:00Z') => ({
    id,
    lead_id,
    status,
    error,
    created_at,
  });

  it('rozmówca jeszcze nie poprosił o kalkulację', () => {
    expect(buildLeadInfo(null, [], [])).toEqual({
      frozenAt: null,
      currentEmail: null,
      lockedEmail: null,
      sentCount: 0,
      lastSentAt: null,
      lastFailure: null,
    });
  });

  it('wysłano: adres, licznik, daty; brak błędu', () => {
    const info = buildLeadInfo(
      '2026-11-11T12:00:00Z',
      [lead('a', 'jan@firma.pl', '2026-11-11T12:00:00Z')],
      [delivery(1, 'a', 'sent', null, '2026-11-11T12:00:05Z'), delivery(2, 'a', 'sent', null, '2026-11-11T12:10:00Z')],
    );
    expect(info).toEqual({
      frozenAt: '2026-11-11T12:00:00Z',
      currentEmail: 'jan@firma.pl',
      lockedEmail: 'jan@firma.pl',
      sentCount: 2,
      lastSentAt: '2026-11-11T12:10:00Z',
      lastFailure: null,
    });
  });

  it('nieudana pierwsza próba: lead jest, nic nie wysłano, widać błąd i adres z literówką', () => {
    const info = buildLeadInfo('2026-11-11T12:00:00Z', [lead('a', 'literowka@firma.pl', '2026-11-11T12:00:00Z')], [delivery(1, 'a', 'failed', 'Mailpit: brak połączenia')]);
    expect(info).toMatchObject({
      currentEmail: 'literowka@firma.pl',
      lockedEmail: null,
      sentCount: 0,
      lastFailure: { error: 'Mailpit: brak połączenia', at: '2026-11-11T12:00:00Z' },
    });
  });

  it('po udanej ponownej próbie błąd znika (liczy się ostatnia próba)', () => {
    const info = buildLeadInfo(
      '2026-11-11T12:00:00Z',
      [lead('a', 'literowka@firma.pl', '2026-11-11T12:00:00Z'), lead('b', 'poprawny@firma.pl', '2026-11-11T12:05:00Z')],
      [delivery(1, 'a', 'failed', 'timeout'), delivery(2, 'b', 'sent')],
    );
    expect(info.lastFailure).toBeNull();
    expect(info).toMatchObject({ currentEmail: 'poprawny@firma.pl', lockedEmail: 'poprawny@firma.pl', sentCount: 1 });
  });

  it('błąd po wcześniejszej udanej wysyłce jest widoczny (ostatnia próba nieudana)', () => {
    const info = buildLeadInfo('x', [lead('a', 'jan@firma.pl', '2026-11-11T12:00:00Z')], [delivery(1, 'a', 'sent'), delivery(2, 'a', 'failed', 'MailerSend HTTP 500')]);
    expect(info.lastFailure?.error).toBe('MailerSend HTTP 500');
    expect(info.sentCount).toBe(1);
  });

  it('kolejność wierszy w odpowiedzi nie ma znaczenia', () => {
    const info = buildLeadInfo(
      'x',
      [lead('b', 'drugi@firma.pl', '2026-11-11T12:05:00Z'), lead('a', 'pierwszy@firma.pl', '2026-11-11T12:00:00Z')],
      [delivery(2, 'b', 'sent'), delivery(1, 'a', 'failed', 'x')],
    );
    expect(info.currentEmail).toBe('drugi@firma.pl');
    expect(info.lastFailure).toBeNull();
  });
});
