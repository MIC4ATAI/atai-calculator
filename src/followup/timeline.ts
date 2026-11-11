/**
 * Oś czasu follow-upu dla konsultanta: zmiany po zamrożeniu stanu pogrupowane w wizyty klienta.
 * Czysta logika (wiersze z bazy → struktura do wyświetlenia); dane czyta RLS po stronie prezentera.
 *
 * Wizyta obejmuje zdarzenia z przedziału [początek, ostatnia aktywność]. Zdarzenia spoza wizyt (np. zmiany
 * konsultanta między wizytami klienta) trafiają do `otherChanges`, żeby nie wyglądały na działania klienta.
 */
import { FIELD_DEFAULTS, FIELD_LABELS, FIELD_UNITS } from '../session/fields.ts';
import { nf } from '../session/format.ts';
import { GUEST_INPUT_KEYS, type GuestInputKey } from '../session/inputs.ts';

/** Wiersz calc_events (kształt z bazy). */
export interface EventRow {
  id: number;
  actor: string;
  field: string;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

/** Wiersz session_visits. */
export interface VisitRow {
  id: string;
  started_at: string;
  last_activity_at: string;
  changed: boolean;
}

export interface TimelineChange {
  id: number;
  at: string;
  actor: 'guest' | 'consultant';
  field: string;
  label: string;
  /** Wartości do wyświetlenia (z jednostkami); „–” = brak wartości. */
  from: string;
  to: string;
}

export interface TimelineVisit {
  id: string;
  startedAt: string;
  lastActivityAt: string;
  changes: TimelineChange[];
}

export interface Timeline {
  /** Wizyty od najnowszej. */
  visits: TimelineVisit[];
  /** Zmiany po zamrożeniu spoza wizyt klienta, od najnowszej. */
  otherChanges: TimelineChange[];
  /** Liczba zmian po zamrożeniu (w wizytach i poza nimi). */
  totalChanges: number;
}

/** Zapas na różnice zegarów między wpisem zdarzenia a wizyty (ta sama transakcja ma ten sam czas, ale nie ufamy). */
const TOLERANCE_MS = 1000;

const PARAM_LABELS: Record<string, string> = {
  celKorzysci: 'Założenie: cel korzyści',
  dniRobocze: 'Założenie: dni robocze',
  godzinyDziennie: 'Założenie: godziny dziennie',
};

const OTHER_LABELS: Record<string, string> = {
  mix_kh: 'Miks: nowi klienci KH',
  revealed: 'Odsłonięcie wyniku',
  reply: 'Odpowiedź rozmówcy',
};

/** Pola, które nie są zmianą symulacji klienta i tylko zaśmiecałyby oś czasu. */
const HIDDEN_FIELDS = new Set(['company_id']);

export function fieldLabel(field: string): string {
  if ((GUEST_INPUT_KEYS as readonly string[]).includes(field)) return FIELD_LABELS[field as GuestInputKey];
  if (field.startsWith('params.')) return PARAM_LABELS[field.slice(7)] ?? `Założenie: ${field.slice(7)}`;
  return OTHER_LABELS[field] ?? field;
}

const MAX_TEXT = 80;

/** Wartość z dziennika (jsonb) → tekst do wyświetlenia. Nie ufamy kształtowi: liczby, napisy, boole, null. */
/** Miejsca po przecinku jak w kolumnach pól (presenterView): współczynniki z jedną cyfrą, reszta całkowita. */
const decimalsFor = (field: string, value: number): number => (field.startsWith('wsp') ? 1 : Number.isInteger(value) ? 0 : 2);

export function formatEventValue(field: string, value: unknown): string {
  const unit = (FIELD_UNITS as Record<string, string | undefined>)[field] ?? '';
  const def = (FIELD_DEFAULTS as Record<string, number | undefined>)[field];
  // Brak wpisu w polu z podpowiedzią oznacza wartość domyślną (jak w widoku „na żywo”), nie „nic”.
  if (value === null || value === undefined || value === '') {
    if (def !== undefined) return `${nf(def, decimalsFor(field, def))}${unit} (domyślne)`;
    return value === '' ? '(puste)' : '–';
  }
  if (typeof value === 'boolean') return value ? 'tak' : 'nie';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${nf(value, decimalsFor(field, value))}${unit}`;
  }
  if (typeof value === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
  return '–';
}

const ms = (iso: string): number => new Date(iso).getTime();

export function buildTimeline(events: EventRow[], visits: VisitRow[], frozenAt: string): Timeline {
  const frozen = ms(frozenAt);
  const ordered = [...visits].sort((a, b) => ms(a.started_at) - ms(b.started_at));

  const groups = new Map<string, TimelineChange[]>(ordered.map((v) => [v.id, []]));
  const other: TimelineChange[] = [];
  let total = 0;

  const relevant = events
    .filter((e) => !HIDDEN_FIELDS.has(e.field) && ms(e.created_at) >= frozen && (e.actor === 'guest' || e.actor === 'consultant'))
    .sort((a, b) => ms(a.created_at) - ms(b.created_at) || a.id - b.id);

  for (const e of relevant) {
    const change: TimelineChange = {
      id: e.id,
      at: e.created_at,
      actor: e.actor as 'guest' | 'consultant',
      field: e.field,
      label: fieldLabel(e.field),
      from: formatEventValue(e.field, e.old_value),
      to: formatEventValue(e.field, e.new_value),
    };
    total += 1;
    const at = ms(e.created_at);
    // Zmiany konsultanta nigdy nie są częścią wizyty klienta, nawet jeśli wypadły w jej oknie czasowym.
    const visit =
      e.actor === 'guest'
        ? ordered.find((v) => at >= ms(v.started_at) - TOLERANCE_MS && at <= ms(v.last_activity_at) + TOLERANCE_MS)
        : undefined;
    if (visit) groups.get(visit.id)!.push(change);
    else other.push(change);
  }

  return {
    visits: [...ordered]
      .reverse()
      .map((v) => ({ id: v.id, startedAt: v.started_at, lastActivityAt: v.last_activity_at, changes: groups.get(v.id)! })),
    otherChanges: other.reverse(),
    totalChanges: total,
  };
}
