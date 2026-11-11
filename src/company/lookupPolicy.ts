/**
 * Pamięć podręczna firm w tabeli `companies`: dane z GUS są świeże przez 30 dni, więc ponowne
 * wpisanie tego samego NIP-u w tej samej organizacji nie odpytuje GUS. Firma, o której wiemy
 * tylko „GUS niedostępny”, nigdy nie jest uznana za świeżą — próbujemy ponownie.
 */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface CacheCandidate {
  gus_status: string;
  fetched_at: string;
}

export function isCacheUsable(row: CacheCandidate, nowMs: number): boolean {
  if (row.gus_status !== 'found') return false;
  const fetchedMs = Date.parse(row.fetched_at);
  if (Number.isNaN(fetchedMs)) return false;
  const age = nowMs - fetchedMs;
  return age >= 0 && age < CACHE_TTL_MS;
}
