/**
 * Widok follow-upu dla konsultanta „rozmowa vs ostatnia symulacja”: trzy kolumny (stan z rozmowy, bieżąca symulacja,
 * zmiany po rozmowie). Czysta logika: wiersze z bazy (RLS) → struktura do wyświetlenia. Liczby bieżące liczy
 * src/calc, ze snapshotu czytamy tylko to, co zapisano. W odróżnieniu od widoku klienta konsultant widzi też dane
 * wejściowe i przychód z miksu (nie widzi tu jednak cichych założeń ani kosztów — nie są potrzebne do rozmowy).
 */
import { mix, type CalcParams } from '../calc/calculator.ts';
import { FIELD_DEFAULTS, FIELD_LABELS, FIELD_ORDER, FIELD_UNITS } from '../session/fields.ts';
import { nf } from '../session/format.ts';
import { computeCalc, type GuestInputKey, type InputValue, type SessionInputs } from '../session/guestView.ts';
import { compareToConversation, readConversation, type Comparison, type SnapshotRowLike } from './conversation.ts';
import { buildTimeline, type EventRow, type Timeline, type VisitRow } from './timeline.ts';

export interface SimulationSummary {
  godziny: number;
  nowiKh: number;
  nowiKpir: number;
  /** Przychód miesięczny z miksu (null bez przychodu rozmówcy). */
  przychodMies: number | null;
}

export interface FieldRow {
  key: GuestInputKey;
  label: string;
  conversation: string;
  current: string;
  /** Wartość bieżąca różni się od tej z rozmowy (brak wpisu i puste pole to to samo). */
  changed: boolean;
}

export interface PresenterFollowUp {
  frozenAt: string;
  calcVersion: string;
  conversation: SimulationSummary;
  /** null, gdy bieżące dane są niekompletne. */
  current: SimulationSummary | null;
  comparison: Comparison;
  /** Różnica przychodu miesięcznego (bieżący − z rozmowy); null, gdy któregoś brakuje. */
  deltaPrzychod: number | null;
  rows: FieldRow[];
  timeline: Timeline;
  /** Liczba wizyt klienta po zamrożeniu i moment ostatniej aktywności. */
  returns: number;
  lastActivityAt: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Wartość pola do wyświetlenia; brak wpisu przy polu z podpowiedzią to wartość domyślna (jak w widoku „na żywo”). */
export function formatInputValue(key: GuestInputKey, value: InputValue | undefined): string {
  const unit = FIELD_UNITS[key] ?? '';
  const decimals = key.startsWith('wsp') ? 1 : 0;
  if (typeof value === 'number') return `${nf(value, decimals)}${unit}`;
  const def = FIELD_DEFAULTS[key];
  return def !== undefined ? `${nf(def, decimals)}${unit} (domyślne)` : '–';
}

const asNumberOrNull = (v: InputValue | undefined): number | null => (typeof v === 'number' ? v : null);

export function buildFieldRows(conversationInputs: SessionInputs, currentInputs: SessionInputs): FieldRow[] {
  return FIELD_ORDER.map((key) => ({
    key,
    label: FIELD_LABELS[key],
    conversation: formatInputValue(key, conversationInputs[key]),
    current: formatInputValue(key, currentInputs[key]),
    changed: asNumberOrNull(conversationInputs[key]) !== asNumberOrNull(currentInputs[key]),
  }));
}

export interface PresenterFollowUpInput {
  snapshot: SnapshotRowLike;
  /** Bieżące dane sesji (z RLS) i miks wybrany suwakiem. */
  inputs: SessionInputs;
  params: CalcParams;
  mixKh: number | null;
  events: EventRow[];
  visits: VisitRow[];
}

/** Uszkodzony snapshot → null (strona pokaże komunikat zamiast nieprawdziwych liczb). */
export function buildPresenterFollowUp(input: PresenterFollowUpInput): PresenterFollowUp | null {
  const conversation = readConversation(input.snapshot);
  if (!conversation) return null;
  const { view } = conversation;

  const snapshotMix = input.snapshot.mix;
  const conversationPrzychod =
    isRecord(snapshotMix) && typeof snapshotMix.przychodMies === 'number' && Number.isFinite(snapshotMix.przychodMies)
      ? snapshotMix.przychodMies
      : null;

  const calc = computeCalc(input.inputs, input.params);
  let current: SimulationSummary | null = null;
  let calcVersion = '';
  if (calc) {
    const m = mix(calc.result, input.mixKh ?? calc.result.maksNowychKh, calc.wspCzasu);
    current = { godziny: calc.result.godzinyDoOdzyskania, nowiKh: m.kh, nowiKpir: m.kpir, przychodMies: m.przychodMies };
    calcVersion = calc.result.calcVersion;
  }

  const comparison = compareToConversation(conversation, input.inputs, current && { ...current, calcVersion });
  const conversationSummary: SimulationSummary = {
    godziny: view.godziny,
    nowiKh: view.nowiKh,
    nowiKpir: view.nowiKpir,
    przychodMies: conversationPrzychod,
  };

  const lastActivity = input.visits.reduce<string | null>(
    (latest, v) => (latest === null || Date.parse(v.last_activity_at) > Date.parse(latest) ? v.last_activity_at : latest),
    null,
  );

  return {
    frozenAt: view.frozenAt,
    calcVersion: view.calcVersion,
    conversation: conversationSummary,
    current,
    comparison,
    deltaPrzychod:
      current && current.przychodMies !== null && conversationPrzychod !== null ? current.przychodMies - conversationPrzychod : null,
    rows: buildFieldRows(conversation.inputs, input.inputs),
    timeline: buildTimeline(input.events, input.visits, view.frozenAt),
    returns: input.visits.length,
    lastActivityAt: lastActivity,
  };
}

// ---------------------------------------------------------------------------
// Plakietka „Klient wrócił” na liście sesji
// ---------------------------------------------------------------------------
export interface VisitStat {
  count: number;
  lastStartedAt: string;
}

/** Wizyty (po jednej na wiersz) → liczba i moment ostatniej wizyty na sesję. */
export function summarizeVisits(rows: { session_id: string; started_at: string }[]): Map<string, VisitStat> {
  const out = new Map<string, VisitStat>();
  for (const r of rows) {
    const prev = out.get(r.session_id);
    if (!prev) out.set(r.session_id, { count: 1, lastStartedAt: r.started_at });
    else
      out.set(r.session_id, {
        count: prev.count + 1,
        lastStartedAt: Date.parse(r.started_at) > Date.parse(prev.lastStartedAt) ? r.started_at : prev.lastStartedAt,
      });
  }
  return out;
}
