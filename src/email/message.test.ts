import { describe, expect, it } from 'vitest';
import { parseBrand } from './brand';
import { buildCalculationMessage, type BuildMessageArgs } from './message';

const attachment = { filename: 'kalkulacja-2026-11-11.xlsx', contentType: 'application/octet-stream', content: new Uint8Array([80, 75, 3, 4]) };
const rendered = { subject: 'Temat', html: '<p>html</p>', text: 'tekst' };
const defaultSender = { email: 'domyslny@platforma.test', name: 'Kalkulator' };

const args = (over: Partial<BuildMessageArgs> = {}): BuildMessageArgs => ({
  rendered,
  brand: parseBrand({ senderName: 'MITAX Consulting', senderEmail: 'kalkulator@mitax.test' }),
  organizationName: 'MITAX Consulting sp. z o.o.',
  defaultSender,
  recipient: 'rozmowca@firma.pl',
  replyTo: { email: 'ola@mitax.test', name: 'Ola Konsultant' },
  attachment,
  ...over,
});

describe('buildCalculationMessage', () => {
  it('nadawca z marki organizacji, odbiorca, odpowiedź do konsultanta, jeden załącznik', () => {
    expect(buildCalculationMessage(args())).toEqual({
      from: { email: 'kalkulator@mitax.test', name: 'MITAX Consulting' },
      to: { email: 'rozmowca@firma.pl' },
      replyTo: { email: 'ola@mitax.test', name: 'Ola Konsultant' },
      subject: 'Temat',
      html: '<p>html</p>',
      text: 'tekst',
      attachments: [attachment],
    });
  });

  it('bez własnego nadawcy w marce: nadawca awaryjny, a nazwa to organizacja', () => {
    const msg = buildCalculationMessage(args({ brand: {} }));
    expect(msg.from).toEqual({ email: 'domyslny@platforma.test', name: 'MITAX Consulting sp. z o.o.' });
  });

  it('marka bez nazwy nadawcy, ale z adresem: nazwa z organizacji', () => {
    const msg = buildCalculationMessage(args({ brand: parseBrand({ senderEmail: 'a@mitax.test' }) }));
    expect(msg.from).toEqual({ email: 'a@mitax.test', name: 'MITAX Consulting sp. z o.o.' });
  });

  it('nazwa organizacji z niedozwolonymi znakami nie trafia do nagłówka nadawcy', () => {
    const msg = buildCalculationMessage(args({ brand: {}, organizationName: 'A <b> B' }));
    expect(msg.from.name).toBe('Kalkulator'); // wraca nazwa awaryjna
  });

  it('bez odpowiedzi do konsultanta nie ma klucza replyTo', () => {
    expect('replyTo' in buildCalculationMessage(args({ replyTo: null }))).toBe(false);
    expect('replyTo' in buildCalculationMessage(args({ replyTo: undefined }))).toBe(false);
  });

  it('niepoprawny adres konsultanta jest pomijany, a nie psuje wysyłki', () => {
    expect('replyTo' in buildCalculationMessage(args({ replyTo: { email: 'nie-email' } }))).toBe(false);
  });

  it('niepoprawna nazwa konsultanta jest pomijana, adres zostaje', () => {
    const msg = buildCalculationMessage(args({ replyTo: { email: 'ola@mitax.test', name: 'Ola <x>' } }));
    expect(msg.replyTo).toEqual({ email: 'ola@mitax.test' });
  });

  it('odbiorca jest normalizowany, a niepoprawny kończy się błędem (nigdy nie wysyłamy „na zgadywankę”)', () => {
    expect(buildCalculationMessage(args({ recipient: '  Rozmowca@Firma.PL ' })).to.email).toBe('rozmowca@firma.pl');
    for (const bad of ['', 'nie-email', 'a@b.pl,c@d.pl', 'a@b.pl\nBcc: x@y.pl']) {
      expect(() => buildCalculationMessage(args({ recipient: bad })), bad).toThrow(/odbiorcy/);
    }
  });
});
