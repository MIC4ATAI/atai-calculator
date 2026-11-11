import { describe, expect, it } from 'vitest';
import { describeLoginOutcome, looksLikeEmail } from './loginErrors';

describe('describeLoginOutcome', () => {
  it('brak błędu = link wysłany', () => {
    expect(describeLoginOutcome(null)).toEqual({ kind: 'sent' });
  });

  it('nieistniejące konto wygląda jak sukces (nie ujawniamy, kto ma konto)', () => {
    expect(describeLoginOutcome({ code: 'otp_disabled', status: 422 })).toEqual({ kind: 'sent' });
    expect(describeLoginOutcome({ code: 'signup_disabled' })).toEqual({ kind: 'sent' });
    expect(describeLoginOutcome({ code: 'user_not_found' })).toEqual({ kind: 'sent' });
  });

  it('limit prób daje czytelny komunikat', () => {
    for (const e of [{ code: 'over_email_send_rate_limit' }, { code: 'over_request_rate_limit' }, { status: 429 }]) {
      const r = describeLoginOutcome(e);
      expect(r.kind).toBe('error');
      if (r.kind === 'error') expect(r.message).toMatch(/Zbyt wiele prób/);
    }
  });

  it('niepoprawny e-mail', () => {
    const r = describeLoginOutcome({ code: 'email_address_invalid' });
    expect(r).toEqual({ kind: 'error', message: 'Podaj poprawny adres e-mail.' });
  });

  it('nieznany błąd nie przepuszcza surowego komunikatu serwera', () => {
    const r = describeLoginOutcome({ code: 'unexpected_failure', message: 'internal: db password=…' });
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).not.toMatch(/internal|password/);
  });
});

describe('looksLikeEmail', () => {
  it('akceptuje typowe adresy i ignoruje białe znaki na brzegach', () => {
    expect(looksLikeEmail('ola@mitax.test')).toBe(true);
    expect(looksLikeEmail('  ola@mitax.test ')).toBe(true);
  });
  it('odrzuca nieprawidłowe', () => {
    for (const v of ['', 'ola', 'ola@', '@mitax.test', 'ola@mitax', 'o la@mitax.test']) {
      expect(looksLikeEmail(v)).toBe(false);
    }
  });
});
