/** Minimalny kształt błędu z Supabase Auth (AuthError), żeby logikę dało się testować bez biblioteki. */
export interface AuthErrorLike {
  code?: string;
  message?: string;
  status?: number;
}

export type LoginOutcome = { kind: 'sent' } | { kind: 'error'; message: string };

/**
 * Wynik próby wysłania magic linku → komunikat dla użytkownika.
 *
 * Konto nieistniejące (rejestracja przez link jest wyłączona) traktujemy tak samo jak sukces,
 * żeby formularz nie ujawniał, które adresy e-mail mają konto.
 */
export function describeLoginOutcome(error: AuthErrorLike | null): LoginOutcome {
  if (!error) return { kind: 'sent' };

  const code = error.code ?? '';
  if (code === 'otp_disabled' || code === 'signup_disabled' || code === 'user_not_found') {
    return { kind: 'sent' };
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || error.status === 429) {
    return { kind: 'error', message: 'Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.' };
  }
  if (code === 'email_address_invalid' || code === 'validation_failed') {
    return { kind: 'error', message: 'Podaj poprawny adres e-mail.' };
  }
  return { kind: 'error', message: 'Nie udało się wysłać linku. Spróbuj ponownie za chwilę.' };
}

/** Prosta kontrola formatu przed wysłaniem; właściwą walidację i tak robi serwer. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
