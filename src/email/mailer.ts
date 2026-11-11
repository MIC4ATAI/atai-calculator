/**
 * Adaptery wysyłki poczty: MailerSend (produkcja) i Mailpit (wyłącznie lokalnie, skrzynka deweloperska).
 *
 * Odczyt środowiska i `fetch` są wstrzykiwane, więc logikę adapterów (nagłówki, adresy, limity czasu, mapowanie
 * błędów) da się przetestować w Vitest bez Deno i bez sieci. Edge Function przekazuje `Deno.env.get` i globalny fetch.
 *
 * Sekrety (token MailerSend) pochodzą wyłącznie ze zmiennych środowiskowych funkcji — nigdy z repozytorium
 * ani z przeglądarki — i nie trafiają do żadnego komunikatu błędu.
 */
import { parseEmail } from './address.ts';
import { parseDisplayName } from './brand.ts';
import type { MailAddress, MailMessage } from './message.ts';
import {
  interpretMailerSendResponse,
  interpretMailpitResponse,
  toMailerSendPayload,
  toMailpitPayload,
  type MailProvider,
  type SendResult,
} from './transport.ts';

export type EnvReader = (name: string) => string | undefined;

/** Błąd konfiguracji (brak tokenu, nieznany transport) — funkcja loguje go i odpowiada 500, nie ujawnia szczegółów. */
export class MailerConfigError extends Error {}

export interface Mailer {
  provider: MailProvider;
  send(message: MailMessage): Promise<SendResult>;
}

export const MAILERSEND_URL = 'https://api.mailersend.com/v1/email';
const SEND_TIMEOUT_MS = 15_000;

const readEnv = (env: EnvReader, name: string): string | undefined => {
  const value = env(name)?.trim();
  return value ? value : undefined;
};

/**
 * Transport z `MAIL_TRANSPORT`: `mailersend` (domyślny — bezpieczny na produkcji) albo `mailpit`.
 * `mailpit` ma sens tylko lokalnie; dostawa jest zapisywana z nazwą dostawcy, więc w danych widać, który był użyty.
 */
export function createMailer(env: EnvReader, fetchFn: typeof fetch = fetch): Mailer {
  const transport = readEnv(env, 'MAIL_TRANSPORT') ?? 'mailersend';

  if (transport === 'mailersend') {
    const token = readEnv(env, 'MAILERSEND_API_TOKEN');
    if (!token) throw new MailerConfigError('Brak MAILERSEND_API_TOKEN');
    return {
      provider: 'mailersend',
      send: (message) =>
        post(
          fetchFn,
          MAILERSEND_URL,
          { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          toMailerSendPayload(message),
          async (res) => interpretMailerSendResponse(res.status, res.headers, await res.text()),
          'MailerSend',
        ),
    };
  }

  if (transport === 'mailpit') {
    const base = readEnv(env, 'MAILPIT_URL');
    if (!base) throw new MailerConfigError('Brak MAILPIT_URL');
    return {
      provider: 'mailpit',
      send: (message) =>
        post(
          fetchFn,
          `${base.replace(/\/+$/, '')}/api/v1/send`,
          { 'Content-Type': 'application/json' },
          toMailpitPayload(message),
          async (res) => interpretMailpitResponse(res.status, await res.text()),
          'Mailpit',
        ),
    };
  }

  throw new MailerConfigError(`Nieznany MAIL_TRANSPORT: ${transport.slice(0, 20)}`);
}

async function post(
  fetchFn: typeof fetch,
  url: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  interpret: (res: Response) => Promise<SendResult>,
  label: string,
): Promise<SendResult> {
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    return await interpret(res);
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    // Bez treści wyjątku: mogłaby zawierać adres z danymi z żądania.
    return { ok: false, error: `${label}: ${timedOut ? 'przekroczono limit czasu' : 'brak połączenia'}`, retryable: true };
  }
}

/** Nadawca awaryjny (organizacja bez własnego): `MAIL_FROM_DEFAULT` (adres) i opcjonalnie `MAIL_FROM_NAME`. */
export function readDefaultSender(env: EnvReader): MailAddress {
  const email = parseEmail(readEnv(env, 'MAIL_FROM_DEFAULT'));
  if (!email) throw new MailerConfigError('Brak lub niepoprawny MAIL_FROM_DEFAULT');
  const name = parseDisplayName(readEnv(env, 'MAIL_FROM_NAME'));
  return { email, ...(name ? { name } : {}) };
}
