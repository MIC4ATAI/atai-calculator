/**
 * Format żądań i interpretacja odpowiedzi dostawców poczty. Czysta logika (Node i Deno) — dzięki temu da się ją
 * dokładnie przetestować; samo wywołanie HTTP robi supabase/functions/_shared/mailer.ts.
 *
 * MailerSend: https://developers.mailersend.com/api/v1/email.html#send-an-email
 * Mailpit (tylko lokalnie): POST /api/v1/send.
 */
import type { MailMessage } from './message.ts';

export type MailProvider = 'mailersend' | 'mailpit';

export type SendResult =
  | { ok: true; id: string | null }
  /** `retryable`: awaria po stronie dostawcy lub limit — ponowienie ma sens; inaczej błąd żądania. */
  | { ok: false; error: string; retryable: boolean };

/** Base64 bajtów w kawałkach (bez przepełnienia stosu na większych plikach). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// MailerSend
// ---------------------------------------------------------------------------
/**
 * Ładunek dla `POST https://api.mailersend.com/v1/email`. Śledzenie otwarć i kliknięć jest wyłączone:
 * to jednorazowa wiadomość na prośbę rozmówcy, bez żadnych elementów marketingowych.
 */
export function toMailerSendPayload(msg: MailMessage): Record<string, unknown> {
  return {
    from: msg.from,
    to: [msg.to],
    ...(msg.replyTo ? { reply_to: msg.replyTo } : {}), // obiekt, nie tablica
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    attachments: msg.attachments.map((a) => ({
      content: bytesToBase64(a.content),
      filename: a.filename,
      disposition: 'attachment',
    })),
    settings: { track_clicks: false, track_opens: false, track_content: false },
  };
}

interface HeaderReader {
  get(name: string): string | null;
}

/** Skraca i czyści tekst błędu do zapisania w `lead_deliveries.error` (do 200 znaków, jedna linia). */
function safeSnippet(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * Odpowiedź MailerSend → wynik wysyłki.
 *
 * Uwaga: 202 bez nagłówka `x-message-id` oznacza, że WSZYSCY odbiorcy są zablokowani (suppressed) i mail
 * NIE został wysłany — mimo kodu sukcesu. Nagłówek `x-send-paused` oznacza wstrzymaną wysyłkę.
 * Żaden z tych przypadków nie może być policzony jako udana dostawa.
 */
export function interpretMailerSendResponse(status: number, headers: HeaderReader, bodyText: string): SendResult {
  if (status === 202) {
    const id = headers.get('x-message-id');
    if (headers.get('x-send-paused') === 'true') {
      return { ok: false, error: 'MailerSend: wysyłka wstrzymana', retryable: true };
    }
    if (!id) return { ok: false, error: 'MailerSend: odbiorca zablokowany (suppressed), mail nie został wysłany', retryable: false };
    return { ok: true, id: safeSnippet(id) };
  }

  if (status === 401 || status === 403) return { ok: false, error: `MailerSend HTTP ${status}: brak autoryzacji`, retryable: false };
  if (status === 429) return { ok: false, error: 'MailerSend HTTP 429: limit zapytań', retryable: true };

  let detail = '';
  try {
    const body = JSON.parse(bodyText) as { message?: unknown; errors?: Record<string, unknown> };
    if (typeof body.message === 'string') detail = body.message;
    const fields = body.errors ? Object.keys(body.errors).slice(0, 3).join(', ') : '';
    if (fields) detail += ` (${fields})`;
  } catch {
    /* odpowiedź bez JSON-a — zostaje sam kod */
  }
  return {
    ok: false,
    error: safeSnippet(`MailerSend HTTP ${status}${detail ? `: ${detail}` : ''}`),
    retryable: status >= 500,
  };
}

// ---------------------------------------------------------------------------
// Mailpit (lokalna skrzynka deweloperska)
// ---------------------------------------------------------------------------
export function toMailpitPayload(msg: MailMessage): Record<string, unknown> {
  const person = (a: { email: string; name?: string }) => ({ Email: a.email, ...(a.name ? { Name: a.name } : {}) });
  return {
    From: person(msg.from),
    To: [person(msg.to)],
    ...(msg.replyTo ? { ReplyTo: [person(msg.replyTo)] } : {}),
    Subject: msg.subject,
    Text: msg.text,
    HTML: msg.html,
    Attachments: msg.attachments.map((a) => ({
      Content: bytesToBase64(a.content),
      Filename: a.filename,
      ContentType: a.contentType,
    })),
  };
}

export function interpretMailpitResponse(status: number, bodyText: string): SendResult {
  if (status !== 200) return { ok: false, error: safeSnippet(`Mailpit HTTP ${status}: ${bodyText}`), retryable: status >= 500 };
  try {
    const id = (JSON.parse(bodyText) as { ID?: unknown }).ID;
    return { ok: true, id: typeof id === 'string' ? safeSnippet(id) : null };
  } catch {
    return { ok: true, id: null };
  }
}
