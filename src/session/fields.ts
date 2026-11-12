import { DEFAULT_INPUTS } from '../calc/calculator.ts';
import type { GuestInputKey, InputValue, SessionInputs } from './guestView.ts';

/** Etykiety pól jak w prototypie. */
export const FIELD_LABELS: Record<GuestInputKey, string> = {
  kh: 'Klienci – pełna księgowość',
  kpir: 'Klienci – KPiR / ryczałt',
  prac: 'Pracownicy',
  przychod: 'Przychód roczny',
  koszty: 'Wynagrodzenia z narzutami / rok',
  ef: 'Czas na pracę z klientami',
  wspCzas: 'Czas obsługi KH vs KPiR',
  wspCena: 'Cena KH vs KPiR',
};

/** Kolejność wierszy w tabeli „Dane od rozmówcy, na żywo”. */
export const FIELD_ORDER: readonly GuestInputKey[] = ['kh', 'kpir', 'prac', 'przychod', 'koszty', 'ef', 'wspCzas', 'wspCena'];

export const FIELD_UNITS: Partial<Record<GuestInputKey, string>> = {
  przychod: ' zł',
  koszty: ' zł',
  ef: ' %',
  wspCzas: ' ×',
  wspCena: ' ×',
};

/**
 * Wartości podpowiadane rozmówcy (UI trzyma efektywność w %). Pochodzą z src/calc,
 * żeby podpowiedź i wartość używana przy pustym polu nigdy się nie rozjechały.
 */
export const FIELD_DEFAULTS: Partial<Record<GuestInputKey, number>> = {
  ef: Math.round(DEFAULT_INPUTS.efektywnosc * 100),
  wspCzas: DEFAULT_INPUTS.wspCzasu,
  wspCena: DEFAULT_INPUTS.wspCeny,
};

/** Dane przykładowe z arkusza „kalkulator-br” (przycisk „Wypełnij przykładem”). */
export const EXAMPLE_INPUTS: SessionInputs = {
  kh: 100,
  kpir: 200,
  prac: 9,
  przychod: 2_000_000,
  koszty: 1_200_000,
};

/** Wartość pola do pokazania: dla pól z podpowiedzią brak wpisu oznacza wartość domyślną. */
export function displayValue(key: GuestInputKey, value: InputValue | undefined): InputValue {
  if (value === undefined) return FIELD_DEFAULTS[key] ?? '';
  return value;
}

/** Czy pole ma wartość domyślną (brak wpisu albo wpisana dokładnie wartość podpowiedzi). */
export function isDefaultValue(key: GuestInputKey, value: InputValue | undefined): boolean {
  const def = FIELD_DEFAULTS[key];
  return def !== undefined && (value === undefined || value === def);
}

/**
 * Wiersz widoku „na żywo” u prezentera: wartość do pokazania i czy to wartość domyślna (znacznik „(domyślne)”).
 * Brak wpisu i puste pole to dla pól z podpowiedzią to samo (kalkulacja używa wtedy wartości domyślnej), więc pokazujemy
 * samą liczbę; „–” zostaje tylko dla pól bez wartości domyślnej.
 */
export function liveRow(key: GuestInputKey, value: InputValue | undefined): { value: number | null; isDefault: boolean } {
  const def = FIELD_DEFAULTS[key];
  if (value === undefined || value === '') return { value: def ?? null, isDefault: def !== undefined };
  return { value, isDefault: isDefaultValue(key, value) };
}
