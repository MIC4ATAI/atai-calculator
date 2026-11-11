/** Formatowanie różnic w pasku „Wynik z rozmowy” (czysta logika, testowana w Vitest). */
import { nf } from '../session/format.ts';

/** Różnica ze znakiem: „+19”, „−3” (prawdziwy minus), „0” — po zaokrągleniu do wyświetlanej dokładności. */
export function formatDelta(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '–';
  const factor = 10 ** decimals;
  const rounded = Math.round(Math.abs(value) * factor) / factor;
  if (rounded === 0) return '0';
  return `${value > 0 ? '+' : '−'}${nf(rounded, decimals)}`;
}
