/**
 * Polityka CTA „Przyślij mi kalkulację jako Excel oraz link do sesji” (spec: „Zamrożenie stanu sesji przy CTA”).
 * Czysta logika (Node i Deno): decyduje, czy wysyłka jest dozwolona, i buduje stan CTA dla rozmówcy.
 *
 * Ostatecznym strażnikiem jest RPC `prepare_calculation_delivery` (SQL: AT005 niegotowa sesja, AT003 limit,
 * AT002 zablokowany adres) — działa też, gdyby ktoś ominął tę warstwę. Ta logika daje tanie, spójne odrzucenia
 * jeszcze przed liczeniem wyniku, budowaniem Excela i wysyłką, oraz komunikaty dla rozmówcy. Stała `MAX_SENDS`
 * musi być równa limitowi w tym RPC (`v_sent >= 3`); pilnuje tego test integracyjny w kroku 2.6.
 */
import { maskEmail, parseEmail } from '../email/address.ts';

/** Maksymalna liczba udanych wysyłek na sesję (jak w SQL). */
export const MAX_SENDS = 3;

/** Podsumowanie dostaw sesji (z tabel leads i lead_deliveries). */
export interface DeliverySummary {
  /** Istnieje lead — NIP jest zablokowany. */
  hasLead: boolean;
  sentCount: number;
  /** Adres, na który poszła pierwsza udana wysyłka; null, gdy jeszcze nic nie wysłano. */
  lockedEmail: string | null;
  lastSentAt: string | null;
}

export interface CtaState {
  /** Konsultant odsłonił wynik. */
  revealed: boolean;
  /** Rozmówca podał NIP (firma przypięta do sesji). */
  hasCompany: boolean;
  /** Dane z formularza dają poprawny wynik (computeCalc ≠ null). */
  dataComplete: boolean;
  /** Liczba udanych wysyłek. */
  sentCount: number;
  /** Adres, na który poszła pierwsza udana wysyłka (znormalizowany); null, gdy jeszcze nic nie wysłano. */
  lockedEmail: string | null;
}

export type CtaRejection =
  | 'not_revealed'
  | 'no_company'
  | 'incomplete_data'
  | 'limit_reached'
  | 'invalid_email'
  | 'email_locked';

export type CtaDecision =
  | { ok: true; kind: 'first' | 'resend'; email: string }
  | { ok: false; reason: CtaRejection };

/** Kolejność sprawdzeń: gotowość sesji → limit → poprawność adresu → blokada adresu. */
export function decideCta(state: CtaState, rawEmail: unknown): CtaDecision {
  if (!state.revealed) return { ok: false, reason: 'not_revealed' };
  if (!state.hasCompany) return { ok: false, reason: 'no_company' };
  if (!state.dataComplete) return { ok: false, reason: 'incomplete_data' };
  if (state.sentCount >= MAX_SENDS) return { ok: false, reason: 'limit_reached' };

  const email = parseEmail(rawEmail);
  if (!email) return { ok: false, reason: 'invalid_email' };
  if (state.sentCount > 0 && state.lockedEmail !== null && state.lockedEmail !== email) {
    return { ok: false, reason: 'email_locked' };
  }
  return { ok: true, kind: state.sentCount === 0 ? 'first' : 'resend', email };
}

/** Komunikaty dla rozmówcy (bez żargonu technicznego). */
export const CTA_MESSAGES: Record<CtaRejection, string> = {
  not_revealed: 'Kalkulację można wysłać po odsłonięciu wyniku przez osobę prowadzącą rozmowę.',
  no_company: 'Najpierw podaj numer NIP firmy.',
  incomplete_data: 'Uzupełnij dane kalkulacji, aby wysłać wynik.',
  limit_reached: 'Kalkulację wysłano już maksymalną liczbę razy.',
  invalid_email: 'Podaj poprawny adres e-mail.',
  email_locked: 'Kalkulacja została już wysłana na inny adres e-mail. Użyj tego samego adresu.',
};

/** Kod HTTP odpowiedzi funkcji dla odrzucenia. */
export function ctaRejectionStatus(reason: CtaRejection): number {
  switch (reason) {
    case 'invalid_email':
      return 400;
    case 'limit_reached':
      return 429;
    default:
      return 409; // stan sesji nie pozwala na tę operację
  }
}

/** Stan CTA w widoku rozmówcy: czy pokazać formularz, ile razy wysłano i na jaki (zamaskowany) adres. */
export interface CtaView {
  /** Czy rozmówca może teraz poprosić o (ponowną) wysyłkę. */
  available: boolean;
  /** Dlaczego nie (gdy `available` = false i sesja jest gotowa albo wyczerpała limit); null, gdy może. */
  blockedReason: Exclude<CtaRejection, 'invalid_email' | 'email_locked'> | null;
  sentCount: number;
  /** Ile wysyłek jeszcze zostało. */
  remaining: number;
  /** Zamaskowany adres zablokowany po pierwszej udanej wysyłce („j***@firma.pl”) albo null. */
  emailMasked: string | null;
}

export function buildCtaView(state: CtaState): CtaView {
  const blockedReason = !state.revealed
    ? 'not_revealed'
    : !state.hasCompany
      ? 'no_company'
      : !state.dataComplete
        ? 'incomplete_data'
        : state.sentCount >= MAX_SENDS
          ? 'limit_reached'
          : null;

  return {
    available: blockedReason === null,
    blockedReason,
    sentCount: state.sentCount,
    remaining: Math.max(0, MAX_SENDS - state.sentCount),
    emailMasked: state.sentCount > 0 && state.lockedEmail ? maskEmail(state.lockedEmail) : null,
  };
}
