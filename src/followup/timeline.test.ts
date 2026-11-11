import { describe, expect, it } from 'vitest';
import { buildTimeline, fieldLabel, formatEventValue, type EventRow, type VisitRow } from './timeline.ts';

const FROZEN = '2026-11-11T12:00:00.000Z';
const at = (min: number, sec = 0) => new Date(Date.parse(FROZEN) + min * 60_000 + sec * 1000).toISOString();

let nextId = 1;
const ev = (min: number, field: string, from: unknown, to: unknown, actor = 'guest', sec = 0): EventRow => ({
  id: nextId++,
  actor,
  field,
  old_value: from,
  new_value: to,
  created_at: at(min, sec),
});
const visit = (id: string, startMin: number, endMin: number, changed = true): VisitRow => ({
  id,
  started_at: at(startMin),
  last_activity_at: at(endMin),
  changed,
});

describe('buildTimeline — grupowanie w wizyty', () => {
  it('zmiany klienta trafiają do wizyty, w której zaszły; wizyty od najnowszej, zmiany od najstarszej', () => {
    const t = buildTimeline(
      [ev(61, 'kh', 100, 120), ev(62, 'kh', 120, 130), ev(300, 'prac', 9, 12)],
      [visit('v1', 60, 65), visit('v2', 299, 301)],
      FROZEN,
    );
    expect(t.visits.map((v) => v.id)).toEqual(['v2', 'v1']);
    expect(t.visits[1]!.changes.map((c) => c.to)).toEqual(['120', '130']);
    expect(t.visits[0]!.changes.map((c) => c.field)).toEqual(['prac']);
    expect(t.otherChanges).toEqual([]);
    expect(t.totalChanges).toBe(3);
  });

  it('wizyta bez zmian jest na liście (sam powrót też jest informacją)', () => {
    const t = buildTimeline([], [visit('v1', 10, 12, false)], FROZEN);
    expect(t.visits).toHaveLength(1);
    expect(t.visits[0]!.changes).toEqual([]);
    expect(t.totalChanges).toBe(0);
  });

  it('zdarzenia sprzed zamrożenia są pomijane (to jeszcze rozmowa, nie follow-up)', () => {
    const t = buildTimeline([ev(-5, 'kh', 1, 2), ev(-1, 'revealed', false, true, 'consultant')], [], FROZEN);
    expect(t.totalChanges).toBe(0);
    expect(t.otherChanges).toEqual([]);
  });

  it('zmiana, która rozpoczęła wizytę (ten sam czas), należy do tej wizyty', () => {
    const t = buildTimeline([ev(60, 'kh', 100, 101)], [visit('v1', 60, 60)], FROZEN);
    expect(t.visits[0]!.changes).toHaveLength(1);
  });

  it('niewielka rozbieżność zegarów (do 1 s) nie wyrzuca zmiany z wizyty', () => {
    const t = buildTimeline([ev(59, 'kh', 1, 2, 'guest', 59.5)], [visit('v1', 60, 61)], FROZEN);
    expect(t.visits[0]!.changes).toHaveLength(1);
  });

  it('zmiana klienta spoza okna wizyty trafia do „innych zmian”, nie do cudzej wizyty', () => {
    const t = buildTimeline([ev(100, 'kh', 1, 2)], [visit('v1', 60, 65)], FROZEN);
    expect(t.visits[0]!.changes).toEqual([]);
    expect(t.otherChanges).toHaveLength(1);
  });

  it('zmiany konsultanta nigdy nie są częścią wizyty klienta, nawet w jej oknie czasowym', () => {
    const t = buildTimeline([ev(62, 'mix_kh', 10, 3, 'consultant')], [visit('v1', 60, 65)], FROZEN);
    expect(t.visits[0]!.changes).toEqual([]);
    expect(t.otherChanges[0]).toMatchObject({ actor: 'consultant', label: 'Miks: nowi klienci KH' });
  });

  it('zmiana firmy (company_id) nie zaśmieca osi czasu; nieznany aktor jest ignorowany', () => {
    const t = buildTimeline([ev(61, 'company_id', null, 'uuid'), ev(61, 'kh', 1, 2, 'system')], [visit('v1', 60, 65)], FROZEN);
    expect(t.totalChanges).toBe(0);
  });

  it('nie zmienia przekazanych tablic i działa przy nieposortowanym wejściu', () => {
    const events = [ev(63, 'kh', 2, 3), ev(61, 'kh', 1, 2)];
    const visits = [visit('v2', 120, 125), visit('v1', 60, 65)];
    const copy = JSON.stringify([events, visits]);
    const t = buildTimeline(events, visits, FROZEN);
    expect(JSON.stringify([events, visits])).toBe(copy);
    expect(t.visits.map((v) => v.id)).toEqual(['v2', 'v1']);
    expect(t.visits[1]!.changes.map((c) => c.from)).toEqual(['1', '2']);
  });
});

describe('etykiety i wartości', () => {
  it('etykiety pól danych jak w widoku rozmówcy, założeń i pozostałych pól', () => {
    expect(fieldLabel('kh')).toBe('Klienci – pełna księgowość');
    expect(fieldLabel('przychod')).toBe('Przychód roczny');
    expect(fieldLabel('params.celKorzysci')).toBe('Założenie: cel korzyści');
    expect(fieldLabel('params.nieznane')).toBe('Założenie: nieznane');
    expect(fieldLabel('mix_kh')).toBe('Miks: nowi klienci KH');
    expect(fieldLabel('reply')).toBe('Odpowiedź rozmówcy');
    expect(fieldLabel('cokolwiek')).toBe('cokolwiek');
  });

  it('wartości: liczby z jednostkami, puste, brak, tak/nie, obcięty długi tekst', () => {
    const norm = (s: string) => s.replace(/\s/g, ' ');
    expect(norm(formatEventValue('przychod', 1_500_000))).toBe('1 500 000 zł');
    expect(formatEventValue('ef', 70)).toBe('70 %');
    expect(formatEventValue('kh', 100)).toBe('100');
    expect(formatEventValue('wspCzas', 2.5)).toBe('2,5 ×');
    expect(formatEventValue('wspCena', 4)).toBe('4,0 ×');
    expect(formatEventValue('kh', null)).toBe('–');
    expect(formatEventValue('kh', undefined)).toBe('–');
    expect(formatEventValue('kh', '')).toBe('(puste)');
    expect(formatEventValue('revealed', true)).toBe('tak');
    expect(formatEventValue('revealed', false)).toBe('nie');
    expect(formatEventValue('reply', 'a'.repeat(200))).toBe(`${'a'.repeat(80)}…`);
  });

  it('brak wpisu w polu z podpowiedzią to wartość domyślna, nie „nic”', () => {
    expect(formatEventValue('ef', null)).toBe('80 % (domyślne)');
    expect(formatEventValue('ef', '')).toBe('80 % (domyślne)');
    expect(formatEventValue('wspCzas', null)).toBe('2,0 × (domyślne)');
    expect(formatEventValue('przychod', null)).toBe('–');
    expect(formatEventValue('przychod', '')).toBe('(puste)');
  });

  it('kształty, których nie rozumiemy, nie wywracają widoku', () => {
    expect(formatEventValue('kh', { a: 1 })).toBe('–');
    expect(formatEventValue('kh', [1, 2])).toBe('–');
    expect(formatEventValue('kh', Number.NaN)).toBe('–');
    expect(formatEventValue('kh', Infinity)).toBe('–');
  });

  it('zmiana w osi czasu niesie czytelne „było → jest”', () => {
    const t = buildTimeline([ev(61, 'ef', 80, 70)], [visit('v1', 60, 65)], FROZEN);
    expect(t.visits[0]!.changes[0]).toMatchObject({ label: 'Czas na pracę z klientami', from: '80 %', to: '70 %', actor: 'guest' });
    const first = buildTimeline([ev(61, 'ef', null, 70)], [visit('v1', 60, 65)], FROZEN);
    expect(first.visits[0]!.changes[0]).toMatchObject({ from: '80 % (domyślne)', to: '70 %' });
  });
});
