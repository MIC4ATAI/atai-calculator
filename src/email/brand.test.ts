import { describe, expect, it } from 'vitest';
import { parseBrand, parseDisplayName, parseHttpsUrl } from './brand';

describe('parseBrand', () => {
  it('pełna marka z seeda MITAX', () => {
    expect(
      parseBrand({
        senderName: 'MITAX Consulting',
        senderEmail: 'kalkulator@mitax.test',
        primaryColor: '#1f6f5c',
        logoUrl: 'https://mitax.test/logo.png',
        landingUrl: 'https://landing.mitax.test/kalkulator',
      }),
    ).toEqual({
      senderName: 'MITAX Consulting',
      senderEmail: 'kalkulator@mitax.test',
      primaryColor: '#1f6f5c',
      logoUrl: 'https://mitax.test/logo.png',
      landingUrl: 'https://landing.mitax.test/kalkulator',
    });
  });

  it('minimalna marka z seeda AT AI (bez logo, koloru i landing page)', () => {
    expect(parseBrand({ senderName: 'AT AI Solutions', senderEmail: 'kalkulator@atai.test' })).toEqual({
      senderName: 'AT AI Solutions',
      senderEmail: 'kalkulator@atai.test',
    });
  });

  it('pusta, brakująca i niepoprawna marka → pusty obiekt, bez wyjątku', () => {
    for (const v of [{}, null, undefined, 'tekst', 5, [], [{ logoUrl: 'https://a.pl' }]]) expect(parseBrand(v)).toEqual({});
  });

  it('niepoprawne pola są odrzucane pojedynczo, poprawne zostają', () => {
    const brand = parseBrand({
      logoUrl: 'http://mitax.test/logo.png', // nie-https
      primaryColor: 'zielony',
      senderName: '<b>MITAX</b>', // nawiasy kątowe są niedozwolone w nazwie nadawcy
      senderEmail: 'nie-email',
      landingUrl: 'https://landing.mitax.test/',
    });
    expect(brand).toEqual({ landingUrl: 'https://landing.mitax.test/' });
  });

  it('adres nadawcy jest normalizowany, kolor zapisany małymi literami', () => {
    expect(parseBrand({ senderEmail: ' Kalkulator@MITAX.test ', primaryColor: '#1F6F5C' })).toEqual({
      senderEmail: 'kalkulator@mitax.test',
      primaryColor: '#1f6f5c',
    });
  });

  it('nieznane klucze i dziedziczone po prototypie pola są ignorowane', () => {
    const proto = { senderName: 'Z prototypu' };
    const raw = Object.create(proto) as Record<string, unknown>;
    raw.coś = 'inne';
    expect(parseBrand(raw)).toEqual({});
  });
});

describe('parseHttpsUrl', () => {
  it('akceptuje https', () => {
    expect(parseHttpsUrl('https://mitax.test/logo.png')).toBe('https://mitax.test/logo.png');
    expect(parseHttpsUrl('  https://a.pl  ')).toBe('https://a.pl/');
  });
  it.each([
    ['http', 'http://mitax.test/x.png'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:image/png;base64,AAAA'],
    ['dane logowania w URL', 'https://user:haslo@mitax.test/x'],
    ['bez schematu', 'mitax.test/logo.png'],
    ['pusty', ''],
    ['za długi', `https://mitax.test/${'a'.repeat(600)}`],
  ])('odrzuca: %s', (_n, raw) => {
    expect(parseHttpsUrl(raw)).toBeNull();
  });
  it('nie-teksty', () => {
    for (const v of [null, undefined, 5, {}]) expect(parseHttpsUrl(v)).toBeNull();
  });
});

describe('parseDisplayName', () => {
  it('przycina i zbija białe znaki', () => {
    expect(parseDisplayName('  MITAX   Consulting ')).toBe('MITAX Consulting');
  });
  it('odrzuca <, >, cudzysłów, znaki sterujące, pustą i zbyt długą nazwę', () => {
    for (const v of ['A <b>', 'A "B"', 'A\u0000B', '', '   ', 'x'.repeat(101)]) expect(parseDisplayName(v)).toBeNull();
  });
  it('zamienia wstrzyknięcie nagłówka (nowa linia) na jedną linię lub odrzuca', () => {
    expect(parseDisplayName('MITAX\nBcc: x@y.pl')).toBe('MITAX Bcc: x@y.pl'); // \n → spacja, więc nie ma już nowej linii
  });
});
