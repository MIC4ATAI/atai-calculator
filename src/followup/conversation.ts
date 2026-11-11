/**
 * „Wynik z rozmowy” i porównanie z bieżącą symulacją — czysta logika współdzielona przez aplikację (Vite)
 * i Edge Function `guest-session` (Deno), stąd importy z rozszerzeniem .ts.
 *
 * Nie liczy niczego sama (reguła 1: wzory tylko w src/calc): czyta liczby ZAPISANE w snapshocie i zestawia je z
 * liczbami policzonymi przez src/calc dla bieżących danych. Do klienta trafiają wyłącznie godziny i miks —
 * bez kosztów zatrudnienia i bez cichych założeń, jak w reszcie widoku rozmówcy.
 */
import { sanitizeInputs, GUEST_INPUT_KEYS, type SessionInputs } from '../session/inputs.ts';

/** Wiersz calc_snapshots w kształcie, jaki zwraca baza (kolumny jsonb jako unknown — niczemu nie ufamy). */
export interface SnapshotRowLike {
  inputs: unknown;
  result: unknown;
  mix: unknown;
  calc_version: unknown;
  created_at: unknown;
}

/** To, co klient widzi w pasku „Wynik z rozmowy: 121 h → +20 klientów KH”. */
export interface ConversationView {
  /** Moment zamrożenia stanu (ISO). */
  frozenAt: string;
  godziny: number;
  nowiKh: number;
  nowiKpir: number;
  calcVersion: string;
}

/** Stan z rozmowy w pełnej postaci (do porównań po stronie serwera; klient dostaje tylko `view`). */
export interface Conversation {
  view: ConversationView;
  inputs: SessionInputs;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Snapshot → stan z rozmowy; null, gdy zamrożony stan jest uszkodzony (wtedy widok działa bez paska, zamiast
 * się wywrócić albo pokazać nieprawdziwe liczby).
 */
export function readConversation(row: SnapshotRowLike): Conversation | null {
  const { result, mix, calc_version: calcVersion, created_at: createdAt } = row;
  if (!isRecord(result) || !isNumber(result.godzinyDoOdzyskania)) return null;
  if (!isRecord(mix) || !isNumber(mix.kh) || !isNumber(mix.kpir)) return null;
  if (typeof calcVersion !== 'string' || calcVersion === '') return null;
  if (typeof createdAt !== 'string' || Number.isNaN(new Date(createdAt).getTime())) return null;

  return {
    view: {
      frozenAt: createdAt,
      godziny: result.godzinyDoOdzyskania,
      nowiKh: mix.kh,
      nowiKpir: mix.kpir,
      calcVersion,
    },
    inputs: sanitizeInputs(row.inputs),
  };
}

/** Liczby bieżącej symulacji w tej samej postaci co stan z rozmowy. */
export interface SimulationNumbers {
  godziny: number;
  nowiKh: number;
  nowiKpir: number;
}

export interface Comparison {
  /** Bieżące dane lub miks różnią się od stanu z rozmowy — tylko wtedy „Wróć do stanu z rozmowy” ma sens. */
  changed: boolean;
  /** Bieżąca symulacja; null, gdy dane są niekompletne lub niepoprawne (nie ma wyniku do pokazania). */
  current: SimulationNumbers | null;
  /** Różnice bieżąca − z rozmowy; null, gdy nie ma bieżącego wyniku. */
  deltaGodziny: number | null;
  deltaKh: number | null;
  deltaKpir: number | null;
  /**
   * Stan z rozmowy policzono inną wersją logiki (`CALC_VERSION`) niż bieżąca symulacja — różnice mogą wynikać ze
   * zmiany wzorów, nie z danych klienta.
   */
  versionDiffers: boolean;
}

/** Wartości pól do porównania: brak wpisu i puste pole to to samo. */
function canonicalInputs(inputs: SessionInputs): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of GUEST_INPUT_KEYS) {
    const v = inputs[key];
    if (typeof v === 'number') out[key] = v;
  }
  return out;
}

export function inputsDiffer(a: SessionInputs, b: SessionInputs): boolean {
  const ca = canonicalInputs(a);
  const cb = canonicalInputs(b);
  return GUEST_INPUT_KEYS.some((key) => ca[key] !== cb[key]);
}

/**
 * Zestawia bieżącą symulację ze stanem z rozmowy.
 *
 * @param current  liczby policzone przez src/calc dla bieżących danych i miksu wybranego suwakiem
 *                 (null = dane niekompletne); `calcVersion` to wersja logiki, którą je policzono
 */
export function compareToConversation(
  conversation: Conversation,
  inputs: SessionInputs,
  current: (SimulationNumbers & { calcVersion: string }) | null,
): Comparison {
  const { view } = conversation;
  // Dane takie same, a wynik nie istnieje, nie może się zdarzyć dla poprawnego snapshotu — wtedy też „zmienione”.
  const dataChanged = inputsDiffer(conversation.inputs, inputs);
  const mixChanged = current !== null && current.nowiKh !== view.nowiKh;
  const changed = dataChanged || mixChanged || current === null;

  if (!current) {
    return { changed, current: null, deltaGodziny: null, deltaKh: null, deltaKpir: null, versionDiffers: false };
  }
  return {
    changed,
    current: { godziny: current.godziny, nowiKh: current.nowiKh, nowiKpir: current.nowiKpir },
    deltaGodziny: current.godziny - view.godziny,
    deltaKh: current.nowiKh - view.nowiKh,
    deltaKpir: current.nowiKpir - view.nowiKpir,
    versionDiffers: current.calcVersion !== view.calcVersion,
  };
}

/** To, co widok rozmówcy dostaje o follow-upie (null = sesja nie ma zamrożonego stanu). */
export interface FollowUpView {
  conversation: ConversationView;
  comparison: Comparison;
}
