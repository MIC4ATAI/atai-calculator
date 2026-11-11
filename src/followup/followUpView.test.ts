/** Follow-up w widoku rozmówcy: buildGuestView łączy snapshot z żywymi danymi sesji. */
import { describe, expect, it } from 'vitest';
import { mix } from '../calc/calculator.ts';
import { buildGuestView, computeCalc, resolveParams, type SessionInputs, type SessionRow } from '../session/guestView.ts';
import type { SnapshotRowLike } from './conversation.ts';

const PRZYKLAD: SessionInputs = { kh: 100, kpir: 200, prac: 9, przychod: 2_000_000, koszty: 1_200_000 };

function snapshotOf(inputs: SessionInputs = PRZYKLAD, mixKh = 10): SnapshotRowLike {
  const calc = computeCalc(inputs, resolveParams({}))!;
  return {
    inputs,
    result: calc.result,
    mix: mix(calc.result, mixKh, calc.wspCzasu),
    calc_version: calc.result.calcVersion,
    created_at: '2026-11-11T12:00:00.000Z',
  };
}

const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  inputs: PRZYKLAD,
  params: {},
  revealed: true,
  mix_kh: 10,
  reply: '',
  snapshot: snapshotOf(),
  ...over,
});

describe('buildGuestView — follow-up', () => {
  it('bez snapshotu: brak follow-upu', () => {
    expect(buildGuestView(row({ snapshot: null })).followUp).toBeNull();
    expect(buildGuestView(row({ snapshot: undefined })).followUp).toBeNull();
  });

  it('po zamrożeniu i bez zmian: stan z rozmowy i zerowa różnica', () => {
    const f = buildGuestView(row()).followUp!;
    expect(f.conversation.godziny).toBeCloseTo(120.96, 2);
    expect(f.conversation).toMatchObject({ nowiKh: 10, nowiKpir: 20 });
    expect(f.comparison).toMatchObject({ changed: false, deltaGodziny: 0, deltaKh: 0, deltaKpir: 0 });
  });

  it('klient zmienił dane: bieżąca symulacja liczona przez src/calc, różnica względem rozmowy', () => {
    const inputs = { ...PRZYKLAD, prac: 12, koszty: 1_800_000 };
    const view = buildGuestView(row({ inputs }));
    const f = view.followUp!;
    expect(f.comparison.changed).toBe(true);
    expect(f.comparison.current!.godziny).toBeCloseTo(view.result!.godzinyDoOdzyskania, 9);
    expect(f.comparison.deltaGodziny).toBeCloseTo(view.result!.godzinyDoOdzyskania - f.conversation.godziny, 9);
  });

  it('klient przesunął suwak: zmiana miksu jest zmianą', () => {
    const f = buildGuestView(row({ mix_kh: 4 })).followUp!;
    expect(f.comparison.changed).toBe(true);
    expect(f.comparison.deltaKh).toBe(-6);
  });

  it('po „Wróć do stanu z rozmowy” (dane i miks ze snapshotu) różnica znika', () => {
    const snap = snapshotOf();
    const edited = buildGuestView(row({ inputs: { ...PRZYKLAD, kh: 500 }, mix_kh: 2, snapshot: snap })).followUp!;
    expect(edited.comparison.changed).toBe(true);
    const restored = buildGuestView(row({ inputs: snap.inputs, mix_kh: 10, snapshot: snap })).followUp!;
    expect(restored.comparison.changed).toBe(false);
  });

  it('wynik ukryty przez konsultanta: follow-up także jest ukryty', () => {
    const v = buildGuestView(row({ revealed: false }));
    expect(v.result).toBeNull();
    expect(v.followUp).toBeNull();
  });

  it('dane niekompletne po wyczyszczeniu pola: brak bieżącego wyniku, ale stan z rozmowy zostaje', () => {
    const f = buildGuestView(row({ inputs: { ...PRZYKLAD, kh: '' } })).followUp!;
    expect(f.conversation.godziny).toBeCloseTo(120.96, 2);
    expect(f.comparison).toMatchObject({ changed: true, current: null, deltaGodziny: null });
  });

  it('uszkodzony snapshot nie wywraca widoku: reszta widoku działa, follow-up = null', () => {
    const v = buildGuestView(row({ snapshot: { ...snapshotOf(), result: 'zepsute' } }));
    expect(v.followUp).toBeNull();
    expect(v.result).not.toBeNull();
  });

  it('zamrożone liczby pochodzą ze snapshotu, nie z bieżących danych (777 h)', () => {
    const snap = snapshotOf();
    (snap.result as { godzinyDoOdzyskania: number }).godzinyDoOdzyskania = 777;
    expect(buildGuestView(row({ snapshot: snap })).followUp!.conversation.godziny).toBe(777);
  });

  it('klient nie dostaje kosztów ani cichych założeń także przez follow-up', () => {
    const json = JSON.stringify(buildGuestView(row({ params: { celKorzysci: 12_345 } })).followUp);
    for (const hidden of ['kosztMies', 'efektywneGodziny', 'kosztGodziny', 'celKorzysci', 'dniRobocze', 'params', 'inputs']) {
      expect(json).not.toContain(hidden);
    }
  });
});
