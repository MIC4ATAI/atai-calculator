import { describe, expect, it } from 'vitest';
import { LOOKUP_ERROR_MESSAGES, lookupErrorKind, type LookupErrorKind } from './lookupErrors';
import { NIP_REASON_MESSAGES, nipFieldState } from './nipInput';

describe('nipFieldState', () => {
  it('puste pole (też same spacje)', () => {
    expect(nipFieldState('')).toEqual({ kind: 'empty' });
    expect(nipFieldState('   ')).toEqual({ kind: 'empty' });
  });

  it('niepełny NIP nie jest jeszcze błędem — rozmówca pisze', () => {
    expect(nipFieldState('5')).toEqual({ kind: 'incomplete', digits: 1 });
    expect(nipFieldState('526-104')).toEqual({ kind: 'incomplete', digits: 6 });
    expect(nipFieldState('PL')).toEqual({ kind: 'incomplete', digits: 0 });
    expect(nipFieldState('526104056')).toEqual({ kind: 'incomplete', digits: 9 });
  });

  it('poprawny NIP w różnych zapisach zwraca 10 cyfr', () => {
    for (const raw of ['5261040567', '526-104-05-67', '526 104 05 67', 'PL5261040567', ' pl 526-104-05-67 ']) {
      expect(nipFieldState(raw)).toEqual({ kind: 'valid', nip: '5261040567' });
    }
  });

  it('10 cyfr ze złą sumą kontrolną → błąd checksum', () => {
    expect(nipFieldState('5261040568')).toEqual({ kind: 'invalid', reason: 'checksum' });
    // 1234567890: suma ważona daje resztę 10, więc taki NIP jest zawsze niepoprawny.
    expect(nipFieldState('1234567890')).toEqual({ kind: 'invalid', reason: 'checksum' });
  });

  it('za dużo cyfr → błąd length', () => {
    expect(nipFieldState('52610405670')).toEqual({ kind: 'invalid', reason: 'length' });
  });

  it('litery i inne znaki → błąd chars', () => {
    for (const raw of ['52610405ab', 'abcdefghij', '526.104.05.67', '5261040567x']) {
      expect(nipFieldState(raw)).toEqual({ kind: 'invalid', reason: 'chars' });
    }
  });

  it('każdy powód błędu ma komunikat po polsku', () => {
    for (const reason of ['chars', 'length', 'checksum'] as const) {
      expect(NIP_REASON_MESSAGES[reason]).toMatch(/NIP/);
    }
  });
});

describe('lookupErrorKind', () => {
  it.each<[number | null, string | null, LookupErrorKind]>([
    [400, 'invalid_nip', 'invalid_nip'],
    [422, 'company_not_found', 'company_not_found'],
    [409, 'nip_locked', 'nip_locked'],
    [429, 'too_many_changes', 'too_many_changes'],
    [404, 'not_found', 'session_gone'],
    [500, 'server_error', 'unavailable'],
    [400, 'bad_request', 'unavailable'],
    [null, null, 'unavailable'],
  ])('status %s, kod %s → %s', (status, code, expected) => {
    expect(lookupErrorKind(status, code)).toBe(expected);
  });

  it('każdy rodzaj błędu ma komunikat dla rozmówcy', () => {
    for (const kind of Object.keys(LOOKUP_ERROR_MESSAGES) as LookupErrorKind[]) {
      expect(LOOKUP_ERROR_MESSAGES[kind].length).toBeGreaterThan(10);
    }
  });

  it('komunikaty nie ujawniają szczegółów technicznych', () => {
    for (const message of Object.values(LOOKUP_ERROR_MESSAGES)) {
      expect(message).not.toMatch(/GUS|BIR|SOAP|token|RPC|AT00|supabase/i);
    }
  });
});
