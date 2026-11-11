import { describe, expect, it } from 'vitest';
import { parseBrand } from './brand';
import {
  assertSessionUrl,
  escapeHtml,
  LANDING_INVITATION_TEXT,
  ONE_TIME_NOTICE_TEXT,
  readableTextColor,
  renderCalculationEmail,
  resultLine,
  signatureLines,
  singleLine,
  type EmailInput,
} from './template';

const SESSION_URL = 'https://atai.mitax.pl/s/1181ff2144831cd0ae0a4a66cb38a3ad5c821fb4d05ee355';

/** Marka MITAX z seeda: pełna. */
const MITAX = parseBrand({
  senderName: 'MITAX Consulting',
  senderEmail: 'kalkulator@mitax.test',
  primaryColor: '#1f6f5c',
  logoUrl: 'https://mitax.test/logo.png',
  landingUrl: 'https://landing.mitax.test/kalkulator',
});
/** Marka AT AI z seeda: minimalna. */
const ATAI = parseBrand({ senderName: 'AT AI Solutions', senderEmail: 'kalkulator@atai.test' });

const base = (over: Partial<EmailInput> = {}): EmailInput => ({
  organizationName: 'MITAX Consulting sp. z o.o.',
  brand: MITAX,
  consultant: { name: 'Ola Konsultant', phone: '+48 600 100 300', signature: 'Ola Konsultant\nMITAX Consulting sp. z o.o.' },
  company: { name: 'T-MOBILE POLSKA SPÓŁKA AKCYJNA', nip: '5261040567' },
  summary: { godzinyDoOdzyskania: 120.96, maksNowychKh: 20 },
  sessionUrl: SESSION_URL,
  landingInvitation: true, // te testy opisują wersję z włączoną flagą MAIL_LANDING_INVITATION
  ...over,
});

describe('renderCalculationEmail — marka pełna (MITAX)', () => {
  const mail = renderCalculationEmail(base());

  it('temat z nazwą organizacji', () => {
    expect(mail.subject).toBe('Twoja kalkulacja z rozmowy – MITAX Consulting sp. z o.o.');
  });

  it('wynik z rozmowy: godziny i nowi klienci KH', () => {
    expect(resultLine({ godzinyDoOdzyskania: 120.96, maksNowychKh: 20 })).toBe('121 h miesięcznie → +20 klientów KH');
    expect(mail.html).toContain('121 h miesięcznie → +20 klientów KH');
    expect(mail.text).toContain('Wynik z rozmowy: 121 h miesięcznie → +20 klientów KH');
  });

  it('firma z NIP-em i opis załącznika', () => {
    expect(mail.text).toContain('dla firmy T-MOBILE POLSKA SPÓŁKA AKCYJNA (NIP 526-104-05-67)');
    expect(mail.text).toContain('zakładkę „Twoja symulacja”');
  });

  it('link do sesji: w przycisku, w adresie awaryjnym i w tekście', () => {
    expect(mail.html).toContain(`href="${SESSION_URL}"`);
    expect(mail.html).toContain(`skopiuj adres: ${SESSION_URL}`);
    expect(mail.text).toContain(SESSION_URL);
  });

  it('logo z alternatywnym tekstem i kolor marki', () => {
    expect(mail.html).toContain('<img src="https://mitax.test/logo.png" alt="MITAX Consulting sp. z o.o."');
    expect(mail.html).toContain('background:#1f6f5c');
  });

  it('krótkie zaproszenie na landing page organizacji (tylko dopisek, z linkiem)', () => {
    expect(mail.text).toContain(LANDING_INVITATION_TEXT);
    expect(mail.text).toContain('https://landing.mitax.test/kalkulator');
    expect(mail.html).toContain('href="https://landing.mitax.test/kalkulator"');
  });

  it('link na landing page nie niesie tokenu sesji', () => {
    const token = '1181ff2144831cd0ae0a4a66cb38a3ad5c821fb4d05ee355';
    const landingLine = mail.text.split('\n').filter((l) => l.includes('landing.mitax.test'));
    expect(landingLine.join('')).not.toContain(token);
  });

  it('podpis konsultanta z profilu i telefon', () => {
    expect(mail.text).toContain('Pozdrawiamy,\nOla Konsultant\nMITAX Consulting sp. z o.o.\ntel. +48 600 100 300');
    expect(mail.html).toContain('Ola Konsultant<br>MITAX Consulting sp. z o.o.<br>tel. +48 600 100 300');
  });

  it('stopka wyjaśnia, dlaczego przyszła wiadomość, i nie zawiera treści reklamowych ani śledzenia', () => {
    expect(mail.text).toContain(ONE_TIME_NOTICE_TEXT);
    expect(mail.html).toContain(escapeHtml(ONE_TIME_NOTICE_TEXT));
    expect(mail.html).not.toMatch(/<img[^>]+width="1"[^>]+height="1"/); // brak piksela śledzącego
  });

  it('HTML ma język, kodowanie i sensowną strukturę', () => {
    expect(mail.html).toMatch(/^<!doctype html>\s*<html lang="pl">/);
    expect(mail.html).toContain('<meta charset="utf-8">');
    expect(mail.html).toContain('<h1');
  });
});

describe('renderCalculationEmail — marka minimalna (AT AI)', () => {
  const mail = renderCalculationEmail(
    base({
      organizationName: 'AT AI Solutions',
      brand: ATAI,
      consultant: { name: 'Jan Konsultant', phone: null, signature: null },
    }),
  );

  it('bez logo nazwa organizacji jest tekstem, kolor domyślny', () => {
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('>AT AI Solutions</span>');
    expect(mail.html).toContain('#1f6f5c');
  });

  it('flaga wyłączona (domyślnie): brak zaproszenia i brak linku, choć organizacja ma landingUrl', () => {
    for (const off of [undefined, false]) {
      const m = renderCalculationEmail(base({ landingInvitation: off }));
      expect(m.text).not.toContain(LANDING_INVITATION_TEXT);
      expect(m.text).not.toContain('landing.mitax.test');
      expect(m.html).not.toContain(escapeHtml(LANDING_INVITATION_TEXT));
      expect(m.html).not.toContain('landing.mitax.test');
      // reszta wiadomości bez zmian: link do sesji, podpis, stopka
      expect(m.text).toContain(SESSION_URL);
      expect(m.text).toContain('Pozdrawiamy,');
      expect(m.text).toContain(ONE_TIME_NOTICE_TEXT);
    }
  });

  it('flaga włączona, ale organizacja bez landingUrl: też bez zaproszenia', () => {
    const m = renderCalculationEmail(base({ brand: ATAI, landingInvitation: true }));
    expect(m.text).not.toContain(LANDING_INVITATION_TEXT);
  });

  it('bez landing page nie ma żadnego zaproszenia', () => {
    expect(mail.text).not.toContain(LANDING_INVITATION_TEXT);
    expect(mail.html).not.toContain(escapeHtml(LANDING_INVITATION_TEXT));
  });

  it('bez podpisu w profilu: imię i nazwisko oraz organizacja', () => {
    expect(mail.text).toContain('Pozdrawiamy,\nJan Konsultant\nAT AI Solutions');
    expect(mail.text).not.toContain('tel.');
  });
});

describe('renderCalculationEmail — szczegóły', () => {
  it('liczba mnoga: 1 klient KH, a nie „1 klientów”', () => {
    expect(resultLine({ godzinyDoOdzyskania: 10, maksNowychKh: 1 })).toBe('10 h miesięcznie → +1 klient KH');
    expect(resultLine({ godzinyDoOdzyskania: 10, maksNowychKh: 0 })).toBe('10 h miesięcznie → +0 klientów KH');
    expect(resultLine({ godzinyDoOdzyskania: 10, maksNowychKh: 5 })).toBe('10 h miesięcznie → +5 klientów KH');
  });

  it('firma bez nazwy (GUS niedostępny): sam NIP', () => {
    const mail = renderCalculationEmail(base({ company: { name: null, nip: '5261040567' } }));
    expect(mail.text).toContain('dla firmy NIP 526-104-05-67.');
  });

  it('jasny kolor marki dostaje ciemny tekst na przycisku (kontrast)', () => {
    const light = renderCalculationEmail(base({ brand: parseBrand({ primaryColor: '#ffeb3b' }) }));
    expect(light.html).toMatch(/background:#ffeb3b;color:#1d2321/);
    const dark = renderCalculationEmail(base());
    expect(dark.html).toMatch(/background:#1f6f5c;color:#ffffff/);
  });

  it('readableTextColor wybiera kontrastowy kolor tekstu', () => {
    expect(readableTextColor('#000000')).toBe('#ffffff');
    expect(readableTextColor('#ffffff')).toBe('#1d2321');
    expect(readableTextColor('#1f6f5c')).toBe('#ffffff');
    expect(readableTextColor('#ffeb3b')).toBe('#1d2321');
  });
});

describe('renderCalculationEmail — bezpieczeństwo (dane niezaufane)', () => {
  const evil = renderCalculationEmail(
    base({
      organizationName: 'A & B "C" <i>',
      company: { name: '<script>alert(1)</script> "firma"', nip: '5261040567' },
      consultant: {
        name: 'Ola',
        phone: '<script>',
        signature: '<img src=x onerror=alert(1)>\nOla & Spółka',
      },
    }),
  );

  it('żadnego aktywnego znacznika z danych: skrypt i img nie przechodzą do HTML', () => {
    expect(evil.html).not.toContain('<script');
    expect(evil.html).not.toContain('<img src=x');
    expect(evil.html).not.toContain('<i>');
    expect(evil.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &quot;firma&quot;');
    expect(evil.html).toContain('&lt;img src=x onerror=alert(1)&gt;<br>Ola &amp; Spółka');
    expect(evil.html).toContain('A &amp; B &quot;C&quot; &lt;i&gt;');
  });

  it('niepoprawny telefon nie trafia do podpisu', () => {
    expect(evil.html).not.toContain('tel.');
    expect(evil.text).not.toContain('tel.');
  });

  it('temat to zawsze jedna linia (brak wstrzyknięcia nagłówka)', () => {
    const mail = renderCalculationEmail(base({ organizationName: 'MITAX\r\nBcc: ofiara@firma.pl' }));
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).toBe('Twoja kalkulacja z rozmowy – MITAX Bcc: ofiara@firma.pl');
  });

  it('temat ma ograniczoną długość', () => {
    expect(renderCalculationEmail(base({ organizationName: 'x'.repeat(500) })).subject.length).toBeLessThanOrEqual(150);
  });

  it('adres w atrybucie jest escapowany (cudzysłów nie wyrwie się z href)', () => {
    const mail = renderCalculationEmail(base({ sessionUrl: 'https://x.pl/s/a"onmouseover="alert(1)' }));
    expect(mail.html).not.toContain('"onmouseover=');
    expect(mail.html).toMatch(/href="https:\/\/x\.pl\/s\/a%22onmouseover=%22alert\(1\)"/);
  });

  it('adres sesji: tylko http(s) bez danych logowania', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '/s/abc', 'ftp://x.pl/s', 'https://u:p@x.pl/s', '']) {
      expect(() => assertSessionUrl(bad), bad).toThrow();
    }
    expect(assertSessionUrl('http://127.0.0.1:5173/s/abc')).toBe('http://127.0.0.1:5173/s/abc'); // lokalnie
  });
});

describe('signatureLines i singleLine', () => {
  const org = 'MITAX Consulting sp. z o.o.';

  it('podpis z profilu: maks. 5 linii, puste pomijane, każda przycięta do 120 znaków', () => {
    const lines = signatureLines({
      organizationName: org,
      consultant: { name: 'X', phone: null, signature: ['1', '', '2', '3', '4', '5', '6', 'x'.repeat(200)].join('\n') },
    });
    expect(lines).toEqual(['1', '2', '3', '4', '5']);
    const long = signatureLines({ organizationName: org, consultant: { name: 'X', phone: null, signature: 'x'.repeat(200) } });
    expect(long[0]).toHaveLength(120);
  });

  it('telefon nie jest dublowany, gdy jest już w podpisie', () => {
    const lines = signatureLines({
      organizationName: org,
      consultant: { name: 'Ola', phone: '+48 600 100 300', signature: 'Ola\ntel. 600-100-300' },
    });
    expect(lines.filter((l) => l.includes('600'))).toHaveLength(1);
  });

  it('znaki sterujące w podpisie są usuwane', () => {
    const lines = signatureLines({ organizationName: org, consultant: { name: 'Ola', phone: null, signature: 'Ola\u0000\u0007 K.' } });
    expect(lines).toEqual(['Ola K.']);
  });

  it('singleLine usuwa nowe linie, znaki sterujące i separatory linii Unicode', () => {
    expect(singleLine('a\r\nb c\u0000d\t e')).toBe('a b c d e');
  });
});
