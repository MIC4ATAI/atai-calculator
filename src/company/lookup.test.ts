import { describe, expect, it } from 'vitest';
import { CACHE_TTL_MS, isCacheUsable } from './lookupPolicy';
import { parseLookupRequest } from './lookupRequest';

const TOKEN = 'a'.repeat(48);

describe('parseLookupRequest', () => {
  it('poprawny NIP jest normalizowany do 10 cyfr', () => {
    expect(parseLookupRequest({ token: TOKEN, nip: '526-104-05-67' })).toEqual({ ok: true, token: TOKEN, nip: '5261040567' });
    expect(parseLookupRequest({ token: TOKEN, nip: 'PL 5261040567' })).toEqual({ ok: true, token: TOKEN, nip: '5261040567' });
  });

  it('zła suma kontrolna → invalid_nip (osobny kod, żeby UI pokazał właściwy komunikat)', () => {
    expect(parseLookupRequest({ token: TOKEN, nip: '5261040568' })).toEqual({ ok: false, error: 'invalid_nip' });
    expect(parseLookupRequest({ token: TOKEN, nip: '123' })).toEqual({ ok: false, error: 'invalid_nip' });
    expect(parseLookupRequest({ token: TOKEN, nip: 'abcdefghij' })).toEqual({ ok: false, error: 'invalid_nip' });
  });

  it('zły kształt żądania → bad_request', () => {
    for (const body of [null, undefined, 'x', 5, [], { nip: '5261040567' }, { token: 'x', nip: '5261040567' }, { token: TOKEN }, { token: TOKEN, nip: 5261040567 }, { token: 5, nip: '5261040567' }]) {
      expect(parseLookupRequest(body)).toEqual({ ok: false, error: 'bad_request' });
    }
  });

  it('zbyt długi NIP (np. ciąg ataku) → bad_request, bez przetwarzania', () => {
    expect(parseLookupRequest({ token: TOKEN, nip: '5'.repeat(1000) })).toEqual({ ok: false, error: 'bad_request' });
  });

  it('token z niedozwolonymi znakami → bad_request', () => {
    expect(parseLookupRequest({ token: "x'; drop--aaaa", nip: '5261040567' })).toEqual({ ok: false, error: 'bad_request' });
  });
});

describe('isCacheUsable', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('świeże dane z GUS są używane', () => {
    expect(isCacheUsable({ gus_status: 'found', fetched_at: ago(1000) }, now)).toBe(true);
    expect(isCacheUsable({ gus_status: 'found', fetched_at: ago(CACHE_TTL_MS - 1) }, now)).toBe(true);
  });
  it('po 30 dniach odpytujemy GUS ponownie', () => {
    expect(isCacheUsable({ gus_status: 'found', fetched_at: ago(CACHE_TTL_MS) }, now)).toBe(false);
  });
  it('firma bez danych (GUS był niedostępny) nigdy nie jest „świeża”', () => {
    expect(isCacheUsable({ gus_status: 'unavailable', fetched_at: ago(10) }, now)).toBe(false);
  });
  it('niepoprawna lub przyszła data → nie ufamy', () => {
    expect(isCacheUsable({ gus_status: 'found', fetched_at: 'nie-data' }, now)).toBe(false);
    expect(isCacheUsable({ gus_status: 'found', fetched_at: new Date(now + 60_000).toISOString() }, now)).toBe(false);
  });
});
