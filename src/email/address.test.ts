import { describe, expect, it } from 'vitest';
import { isValidEmail, maskEmail, parseEmail } from './address';

describe('parseEmail — poprawne adresy', () => {
  it.each([
    ['jan.kowalski@firma.pl', 'jan.kowalski@firma.pl'],
    ['  Jan.Kowalski@Firma.PL  ', 'jan.kowalski@firma.pl'], // normalizacja
    ['jan+kalkulator@biuro-rachunkowe.com.pl', 'jan+kalkulator@biuro-rachunkowe.com.pl'],
    ["o'brien@firma.pl", "o'brien@firma.pl"],
    ['a@b.pl', 'a@b.pl'],
    ['biuro@księgowość.pl', 'biuro@księgowość.pl'], // domena z polskimi znakami
    ['x_y-z@sub.domena.example', 'x_y-z@sub.domena.example'],
  ])('%s → %s', (raw, expected) => {
    expect(parseEmail(raw)).toBe(expected);
  });
});

describe('parseEmail — odrzuca niepoprawne i niebezpieczne', () => {
  it.each([
    ['pusty', ''],
    ['same spacje', '   '],
    ['bez @', 'jan.firma.pl'],
    ['dwa @', 'jan@@firma.pl'],
    ['dwa @ (2)', 'jan@a@firma.pl'],
    ['bez domeny', 'jan@'],
    ['bez części lokalnej', '@firma.pl'],
    ['domena bez kropki', 'jan@firma'],
    ['TLD z jednej litery', 'jan@firma.p'],
    ['TLD z cyfr', 'jan@firma.123'],
    ['kropka na początku', '.jan@firma.pl'],
    ['kropka na końcu', 'jan.@firma.pl'],
    ['dwie kropki', 'ja..n@firma.pl'],
    ['myślnik na początku etykiety', 'jan@-firma.pl'],
    ['spacja w środku', 'jan kowalski@firma.pl'],
    ['wiele adresów (przecinek)', 'a@firma.pl,b@firma.pl'],
    ['wiele adresów (średnik)', 'a@firma.pl;b@firma.pl'],
    ['nawiasy kątowe', '<a@firma.pl>'],
    ['nazwa i nawiasy', 'Jan <jan@firma.pl>'],
    ['cudzysłów', '"jan"@firma.pl'],
    ['nawias okrągły (komentarz)', 'jan(komentarz)@firma.pl'],
    ['wstrzyknięcie nagłówka (LF)', 'a@firma.pl\nBcc: ofiara@firma.pl'],
    ['wstrzyknięcie nagłówka (CRLF)', 'a@firma.pl\r\nBcc: x@y.pl'],
    ['znak sterujący', 'ja\u0000n@firma.pl'],
    ['ukośnik odwrotny', 'ja\\n@firma.pl'],
  ])('%s', (_name, raw) => {
    expect(parseEmail(raw)).toBeNull();
  });

  it('nie-teksty', () => {
    for (const v of [null, undefined, 5, {}, [], ['a@b.pl']]) expect(parseEmail(v)).toBeNull();
  });

  it('limity długości: część lokalna ≤ 64, całość ≤ 254', () => {
    expect(parseEmail(`${'a'.repeat(64)}@firma.pl`)).not.toBeNull();
    expect(parseEmail(`${'a'.repeat(65)}@firma.pl`)).toBeNull();
    expect(parseEmail(`a@${'b'.repeat(250)}.pl`)).toBeNull();
  });

  it('wszystko, co przejdzie, spełnia też regułę z bazy (leads.email)', () => {
    const dbRule = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const raw of ['jan.kowalski@firma.pl', "o'brien@firma.pl", 'jan+x@a.b.pl', 'biuro@księgowość.pl']) {
      const email = parseEmail(raw)!;
      expect(email).toBe(email.toLowerCase());
      expect(dbRule.test(email)).toBe(true);
    }
  });

  it('isValidEmail zgadza się z parseEmail', () => {
    expect(isValidEmail('jan@firma.pl')).toBe(true);
    expect(isValidEmail('jan@firma')).toBe(false);
  });
});

describe('maskEmail', () => {
  it('pierwsza litera, gwiazdki i cała domena', () => {
    expect(maskEmail('jan.kowalski@firma.pl')).toBe('j***@firma.pl');
    expect(maskEmail('a@b.pl')).toBe('a***@b.pl');
  });
  it('nie ujawnia reszty części lokalnej', () => {
    expect(maskEmail('tajny.adres@firma.pl')).not.toContain('ajny');
  });
  it('niepoprawne wejście nie wyciekuje', () => {
    expect(maskEmail('bez-malpy')).toBe('***');
    expect(maskEmail('@firma.pl')).toBe('***');
  });
});
