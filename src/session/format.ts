/** Formatowanie liczb po polsku (jak w prototypie). */

export function nf(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return value.toLocaleString('pl-PL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function zl(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '–' : `${nf(value)} zł`;
}

/** Czas w minutach: od 3 min pełne minuty, poniżej „1 min 44 s” / „30 s”. */
export function minSec(minutes: number): string {
  if (!Number.isFinite(minutes)) return '–';
  if (minutes >= 3) return `${nf(minutes)} min`;
  const total = Math.round(minutes * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m} min ${s} s` : `${s} s`;
}
