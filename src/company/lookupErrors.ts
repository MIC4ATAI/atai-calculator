/** Błędy funkcji `lookup-company` (kod HTTP + pole `error`) → rodzaj błędu i komunikat dla rozmówcy. */

export type LookupErrorKind =
  | 'invalid_nip'
  | 'company_not_found'
  | 'nip_locked'
  | 'too_many_changes'
  | 'session_gone'
  | 'unavailable';

/** `status` i `code` mogą być null (np. błąd sieci przed odpowiedzią serwera). */
export function lookupErrorKind(status: number | null, code: string | null): LookupErrorKind {
  if (status === 400 && code === 'invalid_nip') return 'invalid_nip';
  if (status === 422 && code === 'company_not_found') return 'company_not_found';
  if (status === 409 && code === 'nip_locked') return 'nip_locked';
  if (status === 429 && code === 'too_many_changes') return 'too_many_changes';
  if (status === 404) return 'session_gone';
  return 'unavailable';
}

export const LOOKUP_ERROR_MESSAGES: Record<LookupErrorKind, string> = {
  invalid_nip: 'Ten numer NIP jest niepoprawny — sprawdź cyfry.',
  company_not_found: 'Nie znaleziono firmy o tym numerze NIP w rejestrze REGON. Sprawdź numer i spróbuj ponownie.',
  nip_locked: 'NIP w tej sesji został już zatwierdzony i nie można go zmienić.',
  too_many_changes: 'Zbyt wiele zmian NIP w tej sesji. Skontaktuj się z osobą prowadzącą rozmowę.',
  session_gone: 'Ta sesja nie istnieje albo została zakończona.',
  unavailable: 'Nie udało się teraz pobrać danych firmy. Spróbuj ponownie za chwilę.',
};
