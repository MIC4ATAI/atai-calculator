import { describe, expect, it } from 'vitest';
import { mix } from '../calc/calculator.ts';
import { computeCalc, resolveParams, type SessionInputs } from '../session/guestView.ts';
import type { SnapshotRowLike } from './conversation.ts';
import { buildFieldRows, buildPresenterFollowUp, formatInputValue, summarizeVisits, type PresenterFollowUpInput } from './presenterView.ts';

const PRZYKLAD: SessionInputs = { kh: 100, kpir: 200, prac: 9, przychod: 2_000_000, koszty: 1_200_000 };
const FROZEN = '2026-11-11T12:00:00.000Z';
const PARAMS = resolveParams({});
const norm = (s: string) => s.replace(/\s/g, ' ');

function snapshotOf(inputs: SessionInputs = PRZYKLAD, mixKh = 10): SnapshotRowLike {
  const calc = computeCalc(inputs, PARAMS)!;
  return {
    inputs,
    result: calc.result,
    mix: mix(calc.result, mixKh, calc.wspCzasu),
    calc_version: calc.result.calcVersion,
    created_at: FROZEN,
  };
}

const input = (over: Partial<PresenterFollowUpInput> = {}): PresenterFollowUpInput => ({
  snapshot: snapshotOf(),
  inputs: PRZYKLAD,
  params: PARAMS,
  mixKh: 10,
  events: [],
  visits: [],
  ...over,
});

describe('formatInputValue', () => {
  it('liczby z jednostkami; współczynniki z jedną cyfrą po przecinku', () => {
    expect(norm(formatInputValue('przychod', 2_000_000))).toBe('2 000 000 zł');
    expect(formatInputValue('ef', 70)).toBe('70 %');
    expect(formatInputValue('wspCzas', 2)).toBe('2,0 ×');
    expect(formatInputValue('kh', 100)).toBe('100');
  });
  it('brak wpisu: wartość domyślna tam, gdzie jest podpowiedź; „–” gdzie nie ma', () => {
    expect(formatInputValue('ef', undefined)).toBe('80 % (domyślne)');
    expect(formatInputValue('ef', '')).toBe('80 % (domyślne)');
    expect(formatInputValue('wspCena', undefined)).toBe('4,0 × (domyślne)');
    expect(formatInputValue('kh', undefined)).toBe('–');
    expect(formatInputValue('przychod', '')).toBe('–');
  });
});

describe('buildFieldRows', () => {
  it('wszystkie pola w kolejności z widoku „na żywo”; zmienione oznaczone', () => {
    const rows = buildFieldRows(PRZYKLAD, { ...PRZYKLAD, prac: 12, ef: 70 });
    expect(rows.map((r) => r.key)).toEqual(['kh', 'kpir', 'prac', 'przychod', 'koszty', 'ef', 'wspCzas', 'wspCena']);
    expect(rows.filter((r) => r.changed).map((r) => r.key)).toEqual(['prac', 'ef']);
    expect(rows.find((r) => r.key === 'prac')).toMatchObject({ conversation: '9', current: '12', changed: true });
  });
  it('puste pole i brak wpisu to to samo (nie jest zmianą)', () => {
    expect(buildFieldRows({ ...PRZYKLAD, ef: '' }, PRZYKLAD).some((r) => r.changed)).toBe(false);
  });
  it('usunięcie wartości z rozmowy jest zmianą', () => {
    const row = buildFieldRows(PRZYKLAD, { ...PRZYKLAD, przychod: '' }).find((r) => r.key === 'przychod')!;
    expect(row).toMatchObject({ changed: true, current: '–' });
  });
});

describe('buildPresenterFollowUp', () => {
  it('bez zmian: liczby ze snapshotu, zerowe różnice, brak wizyt', () => {
    const v = buildPresenterFollowUp(input())!;
    expect(v.conversation.godziny).toBeCloseTo(120.96, 2);
    expect(v.conversation).toMatchObject({ nowiKh: 10, nowiKpir: 20 });
    expect(v.conversation.przychodMies).toBeCloseTo(16_666.67, 1);
    expect(v.comparison).toMatchObject({ changed: false, deltaGodziny: 0, deltaKh: 0, deltaKpir: 0 });
    expect(v.deltaPrzychod).toBeCloseTo(0, 6);
    expect(v.rows.some((r) => r.changed)).toBe(false);
    expect(v.returns).toBe(0);
    expect(v.lastActivityAt).toBeNull();
    expect(v.frozenAt).toBe(FROZEN);
  });

  it('zmiana danych przez klienta: bieżąca symulacja z src/calc i różnice względem rozmowy', () => {
    const inputs = { ...PRZYKLAD, prac: 12 };
    const v = buildPresenterFollowUp(input({ inputs }))!;
    const expected = computeCalc(inputs, PARAMS)!.result.godzinyDoOdzyskania;
    expect(v.current!.godziny).toBeCloseTo(expected, 9);
    expect(v.comparison.changed).toBe(true);
    expect(v.comparison.deltaGodziny).toBeCloseTo(expected - v.conversation.godziny, 9);
    expect(v.rows.filter((r) => r.changed).map((r) => r.key)).toEqual(['prac']);
  });

  it('zmiana miksu suwakiem: różnica w klientach i w przychodzie', () => {
    const v = buildPresenterFollowUp(input({ mixKh: 4 }))!;
    expect(v.comparison).toMatchObject({ changed: true, deltaKh: -6 });
    expect(v.current!.przychodMies).not.toBeNull();
    expect(v.deltaPrzychod).toBe(v.current!.przychodMies! - v.conversation.przychodMies!);
  });

  it('miks null = maksimum (jak w widoku rozmówcy)', () => {
    const v = buildPresenterFollowUp(input({ snapshot: snapshotOf(PRZYKLAD, 20), mixKh: null }))!;
    expect(v.current!.nowiKh).toBe(20);
    expect(v.comparison.changed).toBe(false);
  });

  it('dane niekompletne: brak bieżącego wyniku, stan z rozmowy zostaje, różnice puste', () => {
    const v = buildPresenterFollowUp(input({ inputs: { ...PRZYKLAD, kh: '' } }))!;
    expect(v.current).toBeNull();
    expect(v.comparison).toMatchObject({ changed: true, current: null, deltaGodziny: null });
    expect(v.deltaPrzychod).toBeNull();
    expect(v.conversation.godziny).toBeCloseTo(120.96, 2);
  });

  it('bez przychodu u rozmówcy nie ma różnicy przychodu', () => {
    const noRevenue = { ...PRZYKLAD, przychod: '' as const };
    const v = buildPresenterFollowUp(input({ snapshot: snapshotOf(noRevenue), inputs: noRevenue }))!;
    expect(v.conversation.przychodMies).toBeNull();
    expect(v.deltaPrzychod).toBeNull();
  });

  it('wizyty i zmiany trafiają na oś czasu; liczba powrotów i ostatnia aktywność', () => {
    const v = buildPresenterFollowUp(
      input({
        visits: [
          { id: 'v1', started_at: '2026-11-11T13:00:00.000Z', last_activity_at: '2026-11-11T13:05:00.000Z', changed: true },
          { id: 'v2', started_at: '2026-11-12T09:00:00.000Z', last_activity_at: '2026-11-12T09:01:00.000Z', changed: false },
        ],
        events: [{ id: 1, actor: 'guest', field: 'prac', old_value: 9, new_value: 12, created_at: '2026-11-11T13:02:00.000Z' }],
      }),
    )!;
    expect(v.returns).toBe(2);
    expect(v.lastActivityAt).toBe('2026-11-12T09:01:00.000Z');
    expect(v.timeline.visits.map((x) => x.id)).toEqual(['v2', 'v1']);
    expect(v.timeline.visits[1]!.changes[0]).toMatchObject({ label: 'Pracownicy', from: '9', to: '12' });
  });

  it('uszkodzony snapshot → null (bez nieprawdziwych liczb)', () => {
    expect(buildPresenterFollowUp(input({ snapshot: { ...snapshotOf(), result: 'x' } }))).toBeNull();
  });

  it('zamrożone liczby pochodzą ze snapshotu, nie z bieżących danych (777 h)', () => {
    const snap = snapshotOf();
    (snap.result as { godzinyDoOdzyskania: number }).godzinyDoOdzyskania = 777;
    expect(buildPresenterFollowUp(input({ snapshot: snap }))!.conversation.godziny).toBe(777);
  });
});

describe('summarizeVisits', () => {
  it('liczy wizyty i zapamiętuje najnowszą na sesję', () => {
    const m = summarizeVisits([
      { session_id: 'a', started_at: '2026-11-11T10:00:00.000Z' },
      { session_id: 'b', started_at: '2026-11-11T09:00:00.000Z' },
      { session_id: 'a', started_at: '2026-11-12T10:00:00.000Z' },
      { session_id: 'a', started_at: '2026-11-10T10:00:00.000Z' },
    ]);
    expect(m.get('a')).toEqual({ count: 3, lastStartedAt: '2026-11-12T10:00:00.000Z' });
    expect(m.get('b')).toEqual({ count: 1, lastStartedAt: '2026-11-11T09:00:00.000Z' });
    expect(m.get('c')).toBeUndefined();
  });
  it('pusta lista → pusta mapa', () => {
    expect(summarizeVisits([]).size).toBe(0);
  });
});
