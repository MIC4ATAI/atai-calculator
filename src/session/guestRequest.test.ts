import { describe, expect, it } from 'vitest';
import { MAX_MIX_KH, MAX_REPLY_LENGTH, parseGuestRequest } from './guestRequest.ts';

const TOKEN = 'a'.repeat(48);

describe('parseGuestRequest — token i akcja', () => {
  it('poprawne „get”', () => {
    expect(parseGuestRequest({ action: 'get', token: TOKEN })).toEqual({ ok: true, request: { action: 'get', token: TOKEN } });
  });
  it('odrzuca niepoprawny token', () => {
    for (const token of [undefined, null, 123, '', 'krótki', 'a'.repeat(129), 'zły token!', "x'; drop table--", '../../etc/passwd']) {
      expect(parseGuestRequest({ action: 'get', token }).ok).toBe(false);
    }
  });
  it('odrzuca nieznaną akcję i ciało niebędące obiektem', () => {
    expect(parseGuestRequest({ action: 'delete', token: TOKEN }).ok).toBe(false);
    expect(parseGuestRequest({ token: TOKEN }).ok).toBe(false);
    for (const body of [null, undefined, 'x', 5, [], [{ action: 'get', token: TOKEN }]]) {
      expect(parseGuestRequest(body).ok).toBe(false);
    }
  });
});

describe('parseGuestRequest — patch', () => {
  it('filtruje dane: tylko dozwolone pola', () => {
    const r = parseGuestRequest({
      action: 'patch',
      token: TOKEN,
      patch: { kh: 100, przychod: 2_000_000, celKorzysci: 1, params: { a: 1 }, evil: 'x' },
    });
    expect(r).toEqual({
      ok: true,
      request: { action: 'patch', token: TOKEN, patch: { kh: 100, przychod: 2_000_000 }, mixKh: null, reply: null },
    });
  });

  it('samo „patch” bez pól to dozwolona, pusta zmiana', () => {
    const r = parseGuestRequest({ action: 'patch', token: TOKEN });
    expect(r).toMatchObject({ ok: true, request: { patch: {}, mixKh: null, reply: null } });
  });

  it('patch musi być obiektem', () => {
    for (const patch of ['kh', 5, [1], null]) {
      expect(parseGuestRequest({ action: 'patch', token: TOKEN, patch }).ok).toBe(false);
    }
  });

  it('miks: liczba całkowita w zakresie; null i brak = bez zmiany', () => {
    expect(parseGuestRequest({ action: 'patch', token: TOKEN, mixKh: 0 })).toMatchObject({ ok: true, request: { mixKh: 0 } });
    expect(parseGuestRequest({ action: 'patch', token: TOKEN, mixKh: 12 })).toMatchObject({ ok: true, request: { mixKh: 12 } });
    expect(parseGuestRequest({ action: 'patch', token: TOKEN, mixKh: null })).toMatchObject({ ok: true, request: { mixKh: null } });
    for (const mixKh of [-1, 1.5, '3', NaN, MAX_MIX_KH + 1, {}]) {
      expect(parseGuestRequest({ action: 'patch', token: TOKEN, mixKh }).ok).toBe(false);
    }
  });

  it('odpowiedź: do 2000 znaków', () => {
    expect(parseGuestRequest({ action: 'patch', token: TOKEN, reply: 'a'.repeat(MAX_REPLY_LENGTH) }).ok).toBe(true);
    expect(parseGuestRequest({ action: 'patch', token: TOKEN, reply: 'a'.repeat(MAX_REPLY_LENGTH + 1) }).ok).toBe(false);
    expect(parseGuestRequest({ action: 'patch', token: TOKEN, reply: 5 }).ok).toBe(false);
    expect(parseGuestRequest({ action: 'patch', token: TOKEN, reply: '' })).toMatchObject({ ok: true, request: { reply: '' } });
  });
});

describe('parseGuestRequest — follow-up (wizyta i przywrócenie stanu)', () => {
  it('„get” z flagą wizyty przenosi ją tylko gdy jest prawdziwa', () => {
    expect(parseGuestRequest({ action: 'get', token: TOKEN, visit: true })).toEqual({
      ok: true,
      request: { action: 'get', token: TOKEN, visit: true },
    });
    expect(parseGuestRequest({ action: 'get', token: TOKEN, visit: false })).toEqual({
      ok: true,
      request: { action: 'get', token: TOKEN },
    });
  });

  it('flaga wizyty o złym typie jest odrzucana (nie zgadujemy)', () => {
    for (const visit of ['true', 1, 0, null, {}, []]) {
      expect(parseGuestRequest({ action: 'get', token: TOKEN, visit }).ok, JSON.stringify(visit)).toBe(false);
    }
  });

  it('wizyta nie jest częścią „patch” ani „restore”', () => {
    expect(parseGuestRequest({ action: 'patch', token: TOKEN, visit: true })).toMatchObject({
      ok: true,
      request: { action: 'patch', token: TOKEN },
    });
    expect(parseGuestRequest({ action: 'restore', token: TOKEN, visit: true })).toEqual({
      ok: true,
      request: { action: 'restore', token: TOKEN },
    });
  });

  it('„restore” wymaga poprawnego tokenu i nie przyjmuje danych (przywraca wyłącznie snapshot)', () => {
    expect(parseGuestRequest({ action: 'restore', token: TOKEN })).toEqual({ ok: true, request: { action: 'restore', token: TOKEN } });
    expect(parseGuestRequest({ action: 'restore', token: 'x' }).ok).toBe(false);
    expect(parseGuestRequest({ action: 'restore', token: TOKEN, patch: { kh: 999 }, mixKh: 5 })).toEqual({
      ok: true,
      request: { action: 'restore', token: TOKEN },
    });
  });
});
