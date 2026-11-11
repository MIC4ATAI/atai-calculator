/** Błędy funkcji `request-calculation` (kod HTTP + pole `error`) → rodzaj błędu i komunikat dla rozmówcy. */
import { CTA_MESSAGES, type CtaRejection } from './ctaPolicy.ts';

export type RequestErrorKind = CtaRejection | 'send_failed' | 'session_gone' | 'unavailable';

const REJECTIONS = Object.keys(CTA_MESSAGES) as CtaRejection[];

/** `status` i `code` mogą być null (np. błąd sieci przed odpowiedzią serwera). */
export function requestErrorKind(status: number | null, code: string | null): RequestErrorKind {
  if (code !== null && (REJECTIONS as string[]).includes(code)) return code as CtaRejection;
  // „stan zmienił się w trakcie” i błąd dostawcy poczty: rozmówca po prostu próbuje ponownie.
  if (code === 'send_failed' || code === 'state_changed') return 'send_failed';
  if (status === 404) return 'session_gone';
  return 'unavailable';
}

export const REQUEST_ERROR_MESSAGES: Record<RequestErrorKind, string> = {
  ...CTA_MESSAGES,
  send_failed: 'Nie udało się wysłać wiadomości. Spróbuj ponownie za chwilę.',
  session_gone: 'Ta sesja nie istnieje albo została zakończona.',
  unavailable: 'Nie udało się teraz wysłać kalkulacji. Spróbuj ponownie za chwilę.',
};
