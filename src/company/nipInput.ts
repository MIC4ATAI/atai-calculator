/** Stan pola NIP przy wpisywaniu: walidacja na bieżąco, zanim cokolwiek trafi do serwera. */
import { isValidNip, normalizeNip } from '../calc/nip.ts';

export type NipInvalidReason = 'chars' | 'length' | 'checksum';

export type NipFieldState =
  | { kind: 'empty' }
  /** Mniej niż 10 cyfr — jeszcze nie krzyczymy błędem, rozmówca dopiero pisze. */
  | { kind: 'incomplete'; digits: number }
  | { kind: 'invalid'; reason: NipInvalidReason }
  | { kind: 'valid'; nip: string };

/** Akceptuje myślniki, spacje i prefiks PL (jak `normalizeNip`). */
export function nipFieldState(raw: string): NipFieldState {
  if (raw.trim() === '') return { kind: 'empty' };

  // Białe znaki z brzegów (np. wklejony tekst) przycinamy, bo normalizeNip obcina prefiks PL tylko na początku.
  const normalized = normalizeNip(raw.trim());
  if (!/^\d*$/.test(normalized)) return { kind: 'invalid', reason: 'chars' };
  if (normalized.length < 10) return { kind: 'incomplete', digits: normalized.length };
  if (normalized.length > 10) return { kind: 'invalid', reason: 'length' };
  return isValidNip(normalized) ? { kind: 'valid', nip: normalized } : { kind: 'invalid', reason: 'checksum' };
}

export const NIP_REASON_MESSAGES: Record<NipInvalidReason, string> = {
  chars: 'NIP składa się wyłącznie z cyfr (myślniki i spacje są dozwolone).',
  length: 'NIP ma 10 cyfr — wpisano za dużo.',
  checksum: 'Ten numer NIP jest niepoprawny — sprawdź cyfry.',
};
