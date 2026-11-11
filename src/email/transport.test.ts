import { describe, expect, it } from 'vitest';
import type { MailMessage } from './message';
import {
  bytesToBase64,
  interpretMailerSendResponse,
  interpretMailpitResponse,
  toMailerSendPayload,
  toMailpitPayload,
} from './transport';

const xlsxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x80]);

const msg = (over: Partial<MailMessage> = {}): MailMessage => ({
  from: { email: 'kalkulator@mitax.test', name: 'MITAX Consulting' },
  to: { email: 'rozmowca@firma.pl' },
  replyTo: { email: 'ola@mitax.test', name: 'Ola Konsultant' },
  subject: 'Twoja kalkulacja',
  html: '<p>cześć</p>',
  text: 'cześć',
  attachments: [{ filename: 'kalkulacja-2026-11-11.xlsx', contentType: 'application/octet-stream', content: xlsxBytes }],
  ...over,
});

/** Niezależne od implementacji dekodowanie base64 (atob), żeby test nie powielał kodu testowanego. */
const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
/** Znany wektor: bajty „PK\x03\x04\xff\x00\x80” w base64. */
const XLSX_B64 = 'UEsDBP8AgA==';

const headers = (map: Record<string, string>) => ({ get: (name: string) => map[name.toLowerCase()] ?? null });

describe('bytesToBase64', () => {
  it('znany wektor testowy', () => {
    expect(bytesToBase64(xlsxBytes)).toBe(XLSX_B64);
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
    expect(bytesToBase64(new Uint8Array([77, 97, 110]))).toBe('TWFu'); // „Man”
  });
  it('dekodowanie zwraca dokładnie te same bajty — małe i duże dane (granica kawałków 32 KB)', () => {
    for (const size of [0, 1, 3, 100, 32_767, 32_768, 32_769, 100_000]) {
      const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 31 + 7) % 256);
      expect(fromBase64(bytesToBase64(bytes)), `rozmiar ${size}`).toEqual(bytes);
    }
  });
  it('bajty ≥ 0x80 (binarny .xlsx) nie są zniekształcane', () => {
    expect(fromBase64(bytesToBase64(xlsxBytes))).toEqual(xlsxBytes);
  });
});

describe('toMailerSendPayload (wg dokumentacji MailerSend)', () => {
  const p = toMailerSendPayload(msg()) as Record<string, any>;

  it('pola wymagane: from, to[], subject, html, text', () => {
    expect(p.from).toEqual({ email: 'kalkulator@mitax.test', name: 'MITAX Consulting' });
    expect(p.to).toEqual([{ email: 'rozmowca@firma.pl' }]);
    expect(p.subject).toBe('Twoja kalkulacja');
    expect(p.html).toBe('<p>cześć</p>');
    expect(p.text).toBe('cześć');
  });

  it('reply_to to obiekt (nie tablica)', () => {
    expect(p.reply_to).toEqual({ email: 'ola@mitax.test', name: 'Ola Konsultant' });
    expect(Array.isArray(p.reply_to)).toBe(false);
  });

  it('załącznik: content w base64, filename, disposition attachment', () => {
    expect(p.attachments).toEqual([
      { content: XLSX_B64, filename: 'kalkulacja-2026-11-11.xlsx', disposition: 'attachment' },
    ]);
  });

  it('śledzenie otwarć, kliknięć i treści jest wyłączone (jednorazowa wiadomość na prośbę, nie marketing)', () => {
    expect(p.settings).toEqual({ track_clicks: false, track_opens: false, track_content: false });
  });

  it('bez odpowiedzi do konsultanta nie ma klucza reply_to, a ładunek jest serializowalny bez undefined', () => {
    const noReply = toMailerSendPayload(msg({ replyTo: undefined }));
    expect('reply_to' in noReply).toBe(false);
    expect(JSON.stringify(noReply)).not.toContain('undefined');
    expect(JSON.parse(JSON.stringify(noReply))).toEqual(noReply);
  });

  it('dokładnie jeden odbiorca (konto bez zatwierdzenia dopuszcza max. 1)', () => {
    expect((p.to as unknown[]).length).toBe(1);
    expect('cc' in p || 'bcc' in p).toBe(false);
  });
});

describe('interpretMailerSendResponse', () => {
  it('202 z x-message-id = wysłano', () => {
    expect(interpretMailerSendResponse(202, headers({ 'x-message-id': '5e42957d51f1d94a1070a733' }), '')).toEqual({
      ok: true,
      id: '5e42957d51f1d94a1070a733',
    });
  });

  it('202 BEZ x-message-id = odbiorca zablokowany, mail NIE wysłany (nie wolno liczyć jako dostawy)', () => {
    const r = interpretMailerSendResponse(
      202,
      headers({}),
      JSON.stringify({ message: 'There are some warnings for your request.', warnings: [{ type: 'ALL_SUPPRESSED' }] }),
    );
    expect(r).toMatchObject({ ok: false, retryable: false });
    expect((r as { error: string }).error).toMatch(/zablokowany|suppressed/);
  });

  it('202 z x-send-paused = wysyłka wstrzymana, nie dostarczono', () => {
    const r = interpretMailerSendResponse(202, headers({ 'x-message-id': 'abc', 'x-send-paused': 'true' }), '');
    expect(r).toMatchObject({ ok: false, retryable: true });
  });

  it('422: komunikat i nazwy pól z błędami (np. domena nadawcy niezweryfikowana)', () => {
    const body = JSON.stringify({
      message: 'The given data was invalid.',
      errors: { 'from.email': ['The from.email domain must be verified in your account to send emails. #MS42207'] },
    });
    const r = interpretMailerSendResponse(422, headers({}), body);
    expect(r).toEqual({ ok: false, error: 'MailerSend HTTP 422: The given data was invalid. (from.email)', retryable: false });
  });

  it('401 i 403: brak autoryzacji, bez treści odpowiedzi', () => {
    for (const status of [401, 403]) {
      expect(interpretMailerSendResponse(status, headers({}), '{"message":"Unauthenticated."}')).toEqual({
        ok: false,
        error: `MailerSend HTTP ${status}: brak autoryzacji`,
        retryable: false,
      });
    }
  });

  it('429 i 5xx można ponowić; inne 4xx nie', () => {
    expect(interpretMailerSendResponse(429, headers({}), '')).toMatchObject({ ok: false, retryable: true });
    expect(interpretMailerSendResponse(500, headers({}), '')).toMatchObject({ ok: false, retryable: true });
    expect(interpretMailerSendResponse(503, headers({}), '')).toMatchObject({ ok: false, retryable: true });
    expect(interpretMailerSendResponse(400, headers({}), '')).toMatchObject({ ok: false, retryable: false });
  });

  it('odpowiedź bez JSON-a nie rzuca wyjątku', () => {
    expect(interpretMailerSendResponse(502, headers({}), '<html>Bad gateway</html>')).toEqual({
      ok: false,
      error: 'MailerSend HTTP 502',
      retryable: true,
    });
  });

  it('tekst błędu jest jedną linią i ma najwyżej 200 znaków (trafia do bazy)', () => {
    const body = JSON.stringify({ message: `linia1\nlinia2\u0000 ${'x'.repeat(500)}` });
    const r = interpretMailerSendResponse(422, headers({}), body) as { error: string };
    expect(r.error.length).toBeLessThanOrEqual(200);
    expect(r.error).not.toMatch(/[\n\r\u0000]/);
  });
});

describe('Mailpit', () => {
  it('ładunek z polami wymaganymi przez API Mailpita', () => {
    const p = toMailpitPayload(msg()) as Record<string, any>;
    expect(p.From).toEqual({ Email: 'kalkulator@mitax.test', Name: 'MITAX Consulting' });
    expect(p.To).toEqual([{ Email: 'rozmowca@firma.pl' }]);
    expect(p.ReplyTo).toEqual([{ Email: 'ola@mitax.test', Name: 'Ola Konsultant' }]);
    expect(p.Subject).toBe('Twoja kalkulacja');
    expect(p.HTML).toBe('<p>cześć</p>');
    expect(p.Text).toBe('cześć');
    expect(p.Attachments).toEqual([
      {
        Content: XLSX_B64,
        Filename: 'kalkulacja-2026-11-11.xlsx',
        ContentType: 'application/octet-stream',
      },
    ]);
  });

  it('bez odpowiedzi do konsultanta nie ma ReplyTo', () => {
    expect('ReplyTo' in toMailpitPayload(msg({ replyTo: undefined }))).toBe(false);
  });

  it('odpowiedź 200 z ID = wysłano; 200 bez JSON-a też (Mailpit przyjął)', () => {
    expect(interpretMailpitResponse(200, '{"ID":"1AdtsMtm2K4WmQL80Mpl0V"}\n')).toEqual({ ok: true, id: '1AdtsMtm2K4WmQL80Mpl0V' });
    expect(interpretMailpitResponse(200, 'ok')).toEqual({ ok: true, id: null });
  });

  it('błędy HTTP: 4xx bez ponowienia, 5xx z ponowieniem', () => {
    expect(interpretMailpitResponse(400, 'bad request')).toMatchObject({ ok: false, retryable: false });
    expect(interpretMailpitResponse(500, 'x')).toMatchObject({ ok: false, retryable: true });
  });
});
