import { describe, expect, it } from 'vitest';
import { mix } from '../calc/calculator.ts';
import { computeCalc, resolveParams, type SessionInputs } from '../session/guestView.ts';
import {
  compareToConversation,
  inputsDiffer,
  readConversation,
  type Conversation,
  type SnapshotRowLike,
} from './conversation.ts';

const PRZYKLAD: SessionInputs = { kh: 100, kpir: 200, prac: 9, przychod: 2_000_000, koszty: 1_200_000 };
const FROZEN = '2026-11-11T12:00:00.000Z';

/** Snapshot tak, jak zapisuje go prepare_calculation_delivery: wynik i miks policzone przez src/calc. */
function snapshotOf(inputs: SessionInputs = PRZYKLAD, mixKh: number | null = 10): SnapshotRowLike {
  const calc = computeCalc(inputs, resolveParams({}))!;
  return {
    inputs,
    result: calc.result,
    mix: mix(calc.result, mixKh ?? calc.result.maksNowychKh, calc.wspCzasu),
    calc_version: calc.result.calcVersion,
    created_at: FROZEN,
  };
}

function conversationOf(inputs: SessionInputs = PRZYKLAD, mixKh: number | null = 10): Conversation {
  return readConversation(snapshotOf(inputs, mixKh))!;
}

/** Bieżąca symulacja policzona przez src/calc, tak jak robi to buildGuestView. */
function currentOf(inputs: SessionInputs, mixKh: number | null) {
  const calc = computeCalc(inputs, resolveParams({}))!;
  const m = mix(calc.result, mixKh ?? calc.result.maksNowychKh, calc.wspCzasu);
  return { godziny: calc.result.godzinyDoOdzyskania, nowiKh: m.kh, nowiKpir: m.kpir, calcVersion: calc.result.calcVersion };
}

describe('readConversation', () => {
  it('czyta liczby ZAPISANE w snapshocie (przykład kontrolny: 121 h, miks 10 KH + 20 KPiR)', () => {
    const c = readConversation(snapshotOf())!;
    expect(c.view.godziny).toBeCloseTo(120.96, 2);
    expect(c.view.nowiKh).toBe(10);
    expect(c.view.nowiKpir).toBe(20);
    expect(c.view.frozenAt).toBe(FROZEN);
    expect(c.view.calcVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(c.inputs).toEqual(PRZYKLAD);
  });

  it('nie wyciąga liczb ze snapshotu, które nie powstały z żywych danych: snapshot jest źródłem prawdy', () => {
    const row = snapshotOf();
    (row.result as { godzinyDoOdzyskania: number }).godzinyDoOdzyskania = 777;
    expect(readConversation(row)!.view.godziny).toBe(777);
  });

  it('klient dostaje tylko godziny, miks, datę i wersję — bez kosztów i założeń', () => {
    expect(Object.keys(readConversation(snapshotOf())!.view).sort()).toEqual(
      ['calcVersion', 'frozenAt', 'godziny', 'nowiKh', 'nowiKpir'],
    );
  });

  it('dane ze snapshotu przechodzą przez filtr pól (obce pola znikają)', () => {
    const row = { ...snapshotOf(), inputs: { ...PRZYKLAD, celKorzysci: 1, secret: 'x', params: { a: 1 } } };
    expect(readConversation(row)!.inputs).toEqual(PRZYKLAD);
  });

  it('uszkodzony snapshot → null (widok działa bez paska, nie pokazuje nieprawdziwych liczb)', () => {
    const ok = snapshotOf();
    const broken: Partial<SnapshotRowLike>[] = [
      { result: null },
      { result: [] },
      { result: 'x' },
      { result: {} },
      { result: { godzinyDoOdzyskania: '121' } },
      { result: { godzinyDoOdzyskania: Number.NaN } },
      { result: { godzinyDoOdzyskania: Infinity } },
      { mix: null },
      { mix: {} },
      { mix: { kh: 10 } },
      { mix: { kh: '10', kpir: 20 } },
      { mix: [] },
      { calc_version: '' },
      { calc_version: 1 },
      { calc_version: null },
      { created_at: 'nie data' },
      { created_at: 12345 },
      { created_at: null },
    ];
    for (const patch of broken) {
      expect(readConversation({ ...ok, ...patch }), JSON.stringify(patch)).toBeNull();
    }
  });
});

describe('inputsDiffer', () => {
  it('te same dane → brak różnicy; kolejność kluczy nie ma znaczenia', () => {
    expect(inputsDiffer(PRZYKLAD, { koszty: 1_200_000, przychod: 2_000_000, prac: 9, kpir: 200, kh: 100 })).toBe(false);
  });
  it('zmiana jednego pola → różnica, w obie strony', () => {
    expect(inputsDiffer(PRZYKLAD, { ...PRZYKLAD, kh: 101 })).toBe(true);
    expect(inputsDiffer({ ...PRZYKLAD, kh: 101 }, PRZYKLAD)).toBe(true);
  });
  it('brak wpisu i puste pole to to samo; dopisanie pola albo jego wyczyszczenie to różnica', () => {
    expect(inputsDiffer({ kh: 1 }, { kh: 1, ef: '' })).toBe(false);
    expect(inputsDiffer({ kh: 1, ef: '' }, { kh: 1 })).toBe(false);
    expect(inputsDiffer({ kh: 1 }, { kh: 1, ef: 70 })).toBe(true);
    expect(inputsDiffer({ kh: 1, ef: 70 }, { kh: 1, ef: '' })).toBe(true);
    expect(inputsDiffer({ kh: 1, ef: 70 }, { kh: 1 })).toBe(true);
  });
});

describe('compareToConversation', () => {
  const conv = conversationOf();

  it('bez zmian: changed=false, wszystkie różnice zerowe', () => {
    const c = compareToConversation(conv, PRZYKLAD, currentOf(PRZYKLAD, 10));
    expect(c).toMatchObject({ changed: false, deltaGodziny: 0, deltaKh: 0, deltaKpir: 0, versionDiffers: false });
    expect(c.current).toMatchObject({ nowiKh: 10, nowiKpir: 20 });
  });

  it('klient zmienił dane: różnice liczą się względem snapshotu, nie względem poprzedniej symulacji', () => {
    const changed = { ...PRZYKLAD, prac: 12 };
    const c = compareToConversation(conv, changed, currentOf(changed, 10));
    expect(c.changed).toBe(true);
    expect(c.current!.godziny).toBeCloseTo(currentOf(changed, 10).godziny, 6);
    expect(c.deltaGodziny).toBeCloseTo(currentOf(changed, 10).godziny - conv.view.godziny, 6);
    expect(c.deltaGodziny).not.toBe(0);
  });

  it('zmiana liczby klientów jest zmianą, nawet gdy godziny do odzyskania zostają te same', () => {
    const changed = { ...PRZYKLAD, kh: 150 };
    const c = compareToConversation(conv, changed, currentOf(changed, 10));
    expect(c.changed).toBe(true);
    expect(c.deltaGodziny).toBeCloseTo(0, 9);
  });

  it('sam miks inny niż w rozmowie: changed=true, różnica w klientach', () => {
    const c = compareToConversation(conv, PRZYKLAD, currentOf(PRZYKLAD, 5));
    expect(c).toMatchObject({ changed: true, deltaGodziny: 0, deltaKh: -5 });
    expect(c.deltaKpir).toBe(currentOf(PRZYKLAD, 5).nowiKpir - 20);
  });

  it('miks „maksimum” (null) równy miksowi z rozmowy nie jest zmianą', () => {
    const atMax = conversationOf(PRZYKLAD, null);
    const c = compareToConversation(atMax, PRZYKLAD, currentOf(PRZYKLAD, null));
    expect(c.changed).toBe(false);
    expect(c.current!.nowiKh).toBe(atMax.view.nowiKh);
  });

  it('puste pole w miejscu braku wpisu nie jest zmianą', () => {
    const c = compareToConversation(conv, { ...PRZYKLAD, ef: '' }, currentOf(PRZYKLAD, 10));
    expect(c.changed).toBe(false);
  });

  it('dane niekompletne (brak bieżącego wyniku): changed=true i brak różnic do pokazania', () => {
    const c = compareToConversation(conv, { kh: 100 }, null);
    expect(c).toEqual({ changed: true, current: null, deltaGodziny: null, deltaKh: null, deltaKpir: null, versionDiffers: false });
  });

  it('inna wersja logiki niż w rozmowie jest oznaczona (różnice mogą nie wynikać z danych klienta)', () => {
    const c = compareToConversation(conv, PRZYKLAD, { ...currentOf(PRZYKLAD, 10), calcVersion: '9.9.9' });
    expect(c.versionDiffers).toBe(true);
    expect(c.changed).toBe(false);
  });
});
