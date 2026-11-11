import { describe, expect, it, vi } from 'vitest';
import { createMailer, MailerConfigError, readDefaultSender, MAILERSEND_URL, type EnvReader } from './mailer';
import type { MailMessage } from './message';

const message: MailMessage = {
  from: { email: 'kalkulator@mitax.test', name: 'MITAX Consulting' },
  to: { email: 'rozmowca@firma.pl' },
  subject: 'Temat',
  html: '<p>x</p>',
  text: 'x',
  attachments: [{ filename: 'k.xlsx', contentType: 'application/octet-stream', content: new Uint8Array([1, 2, 3]) }],
};

const env = (map: Record<string, string>): EnvReader => (name) => map[name];

/** Atrapa fetch zwracająca zadaną odpowiedź i zapamiętująca wywołanie. */
function fakeFetch(response: Response | Error) {
  const fn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    if (response instanceof Error) throw response;
    return response.clone();
  });
  return fn as unknown as typeof fetch & { mock: { calls: [string, RequestInit][] } };
}

describe('createMailer — konfiguracja', () => {
  it('domyślnie (brak MAIL_TRANSPORT) to MailerSend — bezpieczne na produkcji', () => {
    expect(createMailer(env({ MAILERSEND_API_TOKEN: 'tok' })).provider).toBe('mailersend');
  });
  it('MailerSend bez tokenu → błąd konfiguracji (nie próbujemy wysyłać „na pusto”)', () => {
    expect(() => createMailer(env({}))).toThrow(MailerConfigError);
    expect(() => createMailer(env({ MAILERSEND_API_TOKEN: '   ' }))).toThrow(/MAILERSEND_API_TOKEN/);
  });
  it('Mailpit bez adresu → błąd konfiguracji', () => {
    expect(() => createMailer(env({ MAIL_TRANSPORT: 'mailpit' }))).toThrow(/MAILPIT_URL/);
  });
  it('nieznany transport → błąd konfiguracji', () => {
    expect(() => createMailer(env({ MAIL_TRANSPORT: 'sendgrid' }))).toThrow(/Nieznany MAIL_TRANSPORT/);
  });
  it('błąd konfiguracji nie zawiera tokenu', () => {
    try {
      createMailer(env({ MAIL_TRANSPORT: 'cokolwiek', MAILERSEND_API_TOKEN: 'sekretny-token' }));
    } catch (e) {
      expect((e as Error).message).not.toContain('sekretny-token');
    }
  });
});

describe('MailerSend', () => {
  it('żądanie: adres API, metoda POST, Bearer z tokenu, JSON z ładunkiem; wynik z x-message-id', async () => {
    const fetchFn = fakeFetch(new Response(null, { status: 202, headers: { 'x-message-id': 'msg-123' } }));
    const result = await createMailer(env({ MAILERSEND_API_TOKEN: 'sekretny-token' }), fetchFn).send(message);

    expect(result).toEqual({ ok: true, id: 'msg-123' });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(MAILERSEND_URL);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sekretny-token');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.from).toEqual(message.from);
    expect(body.to).toEqual([message.to]);
    expect(body.attachments[0]).toMatchObject({ filename: 'k.xlsx', disposition: 'attachment' });
    expect(body.settings).toEqual({ track_clicks: false, track_opens: false, track_content: false });
  });

  it('202 bez x-message-id (odbiorca zablokowany) NIE jest udaną wysyłką', async () => {
    const result = await createMailer(env({ MAILERSEND_API_TOKEN: 't' }), fakeFetch(new Response('{}', { status: 202 }))).send(message);
    expect(result).toMatchObject({ ok: false, retryable: false });
  });

  it('422 niezweryfikowanej domeny nadawcy → błąd z nazwą pola, bez tokenu w treści', async () => {
    const res = new Response(
      JSON.stringify({ message: 'The given data was invalid.', errors: { 'from.email': ['domain must be verified'] } }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    );
    const result = await createMailer(env({ MAILERSEND_API_TOKEN: 'sekretny-token' }), fakeFetch(res)).send(message);
    expect(result).toEqual({ ok: false, error: 'MailerSend HTTP 422: The given data was invalid. (from.email)', retryable: false });
    expect(JSON.stringify(result)).not.toContain('sekretny-token');
  });

  it('awaria sieci → błąd do ponowienia, bez treści wyjątku (mogłaby zawierać dane z żądania)', async () => {
    const result = await createMailer(env({ MAILERSEND_API_TOKEN: 't' }), fakeFetch(new TypeError('fetch failed: rozmowca@firma.pl'))).send(message);
    expect(result).toEqual({ ok: false, error: 'MailerSend: brak połączenia', retryable: true });
    expect(JSON.stringify(result)).not.toContain('rozmowca@firma.pl');
  });

  it('przekroczenie limitu czasu jest rozpoznane', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const result = await createMailer(env({ MAILERSEND_API_TOKEN: 't' }), fakeFetch(timeout)).send(message);
    expect(result).toEqual({ ok: false, error: 'MailerSend: przekroczono limit czasu', retryable: true });
  });

  it('żądanie ma ustawiony limit czasu (AbortSignal)', async () => {
    const fetchFn = fakeFetch(new Response(null, { status: 202, headers: { 'x-message-id': 'm' } }));
    await createMailer(env({ MAILERSEND_API_TOKEN: 't' }), fetchFn).send(message);
    expect(fetchFn.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('Mailpit (lokalnie)', () => {
  const mailpitEnv = env({ MAIL_TRANSPORT: 'mailpit', MAILPIT_URL: 'http://supabase_inbucket_atai-calculator:8025/' });

  it('wysyła na /api/v1/send (adres bez dublowanego ukośnika) i zwraca ID', async () => {
    const fetchFn = fakeFetch(new Response('{"ID":"abc"}', { status: 200 }));
    const mailer = createMailer(mailpitEnv, fetchFn);
    expect(mailer.provider).toBe('mailpit');
    expect(await mailer.send(message)).toEqual({ ok: true, id: 'abc' });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://supabase_inbucket_atai-calculator:8025/api/v1/send');
    expect(JSON.parse(init.body as string)).toMatchObject({ From: { Email: 'kalkulator@mitax.test' }, Subject: 'Temat' });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined(); // lokalnie bez tokenu
  });

  it('błąd Mailpita nie jest udaną wysyłką', async () => {
    const result = await createMailer(mailpitEnv, fakeFetch(new Response('bad', { status: 400 }))).send(message);
    expect(result).toMatchObject({ ok: false, retryable: false });
  });
});

describe('readDefaultSender', () => {
  it('adres i nazwa z MAIL_FROM_DEFAULT / MAIL_FROM_NAME', () => {
    expect(readDefaultSender(env({ MAIL_FROM_DEFAULT: ' Kalkulator@Platforma.test ', MAIL_FROM_NAME: 'Kalkulator efektywności' }))).toEqual({
      email: 'kalkulator@platforma.test',
      name: 'Kalkulator efektywności',
    });
  });
  it('bez nazwy tylko adres; nazwa z niedozwolonymi znakami jest pomijana', () => {
    expect(readDefaultSender(env({ MAIL_FROM_DEFAULT: 'k@p.test' }))).toEqual({ email: 'k@p.test' });
    expect(readDefaultSender(env({ MAIL_FROM_DEFAULT: 'k@p.test', MAIL_FROM_NAME: 'A <b>' }))).toEqual({ email: 'k@p.test' });
  });
  it('brak lub niepoprawny adres → błąd konfiguracji', () => {
    expect(() => readDefaultSender(env({}))).toThrow(MailerConfigError);
    expect(() => readDefaultSender(env({ MAIL_FROM_DEFAULT: 'nie-email' }))).toThrow(MailerConfigError);
  });
});
