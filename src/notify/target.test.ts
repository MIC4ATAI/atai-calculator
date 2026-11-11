import { describe, expect, it } from 'vitest';
import { validateNotifyTarget } from './target.ts';

describe('validateNotifyTarget', () => {
  it('poprawny identyfikator czatu (prywatny i grupowy z minusem), przycinany', () => {
    expect(validateNotifyTarget('telegram', ' 123456789 ')).toEqual({ ok: true, channel: 'telegram', target: '123456789' });
    expect(validateNotifyTarget('telegram', '-1001234567890')).toEqual({ ok: true, channel: 'telegram', target: '-1001234567890' });
  });
  it('pusty identyfikator wyłącza powiadomienia (oba pola null), niezależnie od kanału', () => {
    expect(validateNotifyTarget('telegram', '')).toEqual({ ok: true, channel: null, target: null });
    expect(validateNotifyTarget('', '   ')).toEqual({ ok: true, channel: null, target: null });
  });
  it('odrzuca niepoprawne identyfikatory (lustro ograniczenia z bazy)', () => {
    for (const bad of ['12ab', '1234', '123456789012345678901', '--12345', '12 345', '@nazwa', '+48123456789', '1e10000']) {
      expect(validateNotifyTarget('telegram', bad).ok, bad).toBe(false);
    }
  });
  it('odrzuca nieznany kanał, gdy identyfikator jest podany', () => {
    expect(validateNotifyTarget('sms', '123456789')).toEqual({ ok: false, error: 'Wybierz kanał powiadomień.' });
  });
});
