/**
 * Parytet formuł Excela z `src/calc` (reguła 1: wzory żyją w src/calc i muszą zgadzać się z arkuszem).
 *
 * Zakładka „Twoja symulacja” to druga implementacja wzorów — w języku Excela. Ten test generuje skoroszyt,
 * wczytuje go do silnika formuł (HyperFormula, tylko w testach) i porównuje wyniki formuł z `calculate()` i `mix()`
 * dla wielu zestawów danych, także po zmianie pól wejściowych (jak zrobi to rozmówca w Excelu).
 * Zmiana wzorów w `src/calc` bez zmiany `layout.ts` wywala ten test.
 */
import ExcelJS from 'exceljs';
import { HyperFormula } from 'hyperformula';
import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUTS, DEFAULT_PARAMS, mix, type CalcParams, type CalcResult } from '../calc/calculator';
import { computeCalc, toCalcInputs, type SessionInputs } from '../session/guestView';
import { SIM_ROWS, simCell, type SimKey } from './layout';
import { makeWorkbookInput, PRZYKLAD_INPUTS } from './testFixtures';
import { buildWorkbookBytes } from './workbook';

// ---------------------------------------------------------------------------
// Silnik formuł nad wygenerowanym skoroszytem
// ---------------------------------------------------------------------------
type Cell = string | number | null;

interface Sim {
  hf: HyperFormula;
  /** Wartości buforowane zapisane w pliku (to, co widzi podgląd bez przeliczania). */
  cached: Map<SimKey, unknown>;
  get(key: SimKey): unknown;
  set(key: SimKey, value: Cell): void;
  /** Wpisuje zestaw danych we wszystkie pola wejściowe, jak użytkownik w Excelu. */
  apply(inputs: SessionInputs, params: CalcParams): void;
}

const addr = (hf: HyperFormula, key: SimKey) => hf.simpleCellAddressFromString(simCell(key), 0)!;

async function loadSim(inputs: SessionInputs, params: Partial<CalcParams> = {}): Promise<Sim> {
  const bytes = await buildWorkbookBytes(makeWorkbookInput(inputs, { params }));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as never);
  const ws = wb.getWorksheet('Twoja symulacja')!;

  const data: Cell[][] = [];
  for (let r = 1; r <= ws.rowCount; r += 1) {
    const row: Cell[] = [];
    for (let c = 1; c <= 3; c += 1) {
      const cell = ws.getCell(r, c);
      if (cell.formula) row.push(`=${cell.formula}`);
      else if (typeof cell.value === 'number' || typeof cell.value === 'string') row.push(cell.value);
      else row.push(null);
    }
    data.push(row);
  }
  const hf = HyperFormula.buildFromArray(data, { licenseKey: 'gpl-v3' });

  const cached = new Map<SimKey, unknown>();
  for (const row of SIM_ROWS) {
    if (row.kind === 'formula') cached.set(row.key, ws.getCell(simCell(row.key)).result);
  }

  const set = (key: SimKey, value: Cell): void => void hf.setCellContents(addr(hf, key), value);

  return {
    hf,
    cached,
    get: (key) => hf.getCellValue(addr(hf, key)),
    set,
    apply(next, nextParams) {
      const c = toCalcInputs(next)!;
      set('kh', c.kh);
      set('kpir', c.kpir);
      set('prac', c.pracownicy);
      set('przychod', c.przychodRok ?? null);
      set('koszty', c.kosztyWynagrodzenRok);
      set('ef', c.efektywnosc ?? DEFAULT_INPUTS.efektywnosc);
      set('wspCzas', c.wspCzasu ?? DEFAULT_INPUTS.wspCzasu);
      set('wspCena', c.wspCeny ?? DEFAULT_INPUTS.wspCeny);
      set('cel', nextParams.celKorzysci);
      set('dni', nextParams.dniRobocze);
      set('godz', nextParams.godzinyDziennie);
    },
  };
}

// ---------------------------------------------------------------------------
// Porównanie z src/calc
// ---------------------------------------------------------------------------
const RESULT_KEYS: readonly [SimKey, (r: CalcResult) => number | null][] = [
  ['kosztMies', (r) => r.kosztMies],
  ['rg', (r) => r.efektywneGodziny],
  ['kosztGodziny', (r) => r.kosztGodziny],
  ['godziny', (r) => r.godzinyDoOdzyskania],
  ['udzial', (r) => r.udzialCzasu],
  ['minKpir', (r) => r.minutyKpirMies],
  ['minKh', (r) => r.minutyKhMies],
  ['minKhDzien', (r) => r.minutyKhDzien],
  ['odzyskanyKpir', (r) => r.odzyskanyCzasWKlientachKpir],
  ['maksKh', (r) => r.maksNowychKh],
  ['maksKpir', (r) => r.maksNowychKpir],
  ['cenaKpir', (r) => r.cenaKpir],
  ['cenaKh', (r) => r.cenaKh],
  ['przychodGodz', (r) => r.przychodNaGodzine],
];

const TOLERANCE = 1e-9;

/** Opis niezgodności albo null, gdy wartość z Excela zgadza się z oczekiwaną (null ↔ pusty tekst). */
function mismatch(actual: unknown, expected: number | null): string | null {
  if (expected === null) return actual === '' || actual === null || actual === undefined ? null : `oczekiwano pustej, jest ${String(actual)}`;
  if (typeof actual !== 'number') return `oczekiwano ${expected}, jest ${String(actual)}`;
  const diff = Math.abs(actual - expected);
  return diff <= TOLERANCE * Math.max(1, Math.abs(expected)) ? null : `oczekiwano ${expected}, jest ${actual}`;
}

/** Porównuje wszystkie wyniki i warianty miksu z `calculate()`/`mix()`; zwraca listę niezgodności. */
function compareWithCalc(sim: Sim, inputs: SessionInputs, params: CalcParams): string[] {
  const calc = computeCalc(inputs, params)!;
  const problems: string[] = [];

  for (const [key, pick] of RESULT_KEYS) {
    const m = mismatch(sim.get(key), pick(calc.result));
    if (m) problems.push(`${key}: ${m}`);
  }

  const max = calc.result.maksNowychKh;
  for (const kh of [0, 1, Math.floor(max / 2), max, max + 5, -3, 2.7]) {
    sim.set('mixKhWpis', kh);
    const expected = mix(calc.result, kh, calc.wspCzasu);
    for (const [key, value] of [
      ['mixKh', expected.kh],
      ['mixKpir', expected.kpir],
      ['mixPrzychod', expected.przychodMies],
      ['mixWykorzystanie', expected.wykorzystanieCzasu],
    ] as const) {
      const m = mismatch(sim.get(key), value);
      if (m) problems.push(`miks(${kh}) ${key}: ${m}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Zestawy danych
// ---------------------------------------------------------------------------
interface Dataset {
  name: string;
  inputs: SessionInputs;
  params?: Partial<CalcParams>;
}

/**
 * Odzyskany czas w klientach KPiR wypada tu na 17,999999999999996 (błąd zmiennoprzecinkowy tuż pod 18),
 * więc zwykłe zaokrąglenie w dół dałoby 17, a `floorSafe` w src/calc i `ROUNDDOWN(x+0,000001;0)` w Excelu dają 18.
 */
const FLOOR_EDGE_NAME = 'granica floorSafe (błąd zmiennoprzecinkowy tuż pod liczbą całkowitą)';
const FLOOR_EDGE_INPUTS: SessionInputs = { kh: 0, kpir: 15, prac: 1, przychod: 200_000, koszty: 100_000 };

const DATASETS: Dataset[] = [
  { name: 'przykład kontrolny z arkusza', inputs: PRZYKLAD_INPUTS },
  { name: 'bez przychodu', inputs: { ...PRZYKLAD_INPUTS, przychod: '' } },
  {
    name: 'własne założenia i współczynniki',
    inputs: { kh: 37, kpir: 211, prac: 6, przychod: 1_450_000, koszty: 980_000, ef: 65, wspCzas: 2.5, wspCena: 3.5 },
    params: { celKorzysci: 12_500, dniRobocze: 20, godzinyDziennie: 7.5 },
  },
  { name: 'tylko klienci KH', inputs: { kh: 80, kpir: 0, prac: 5, przychod: 900_000, koszty: 600_000 } },
  { name: 'tylko klienci KPiR', inputs: { kh: 0, kpir: 300, prac: 4, przychod: 700_000, koszty: 480_000 } },
  { name: 'małe biuro', inputs: { kh: 1, kpir: 5, prac: 2, przychod: 300_000, koszty: 200_000 } },
  {
    name: 'równy czas obsługi KH i KPiR (współczynnik 1) i pełna efektywność',
    inputs: { kh: 20, kpir: 20, prac: 3, przychod: 500_000, koszty: 330_000, ef: 100, wspCzas: 1, wspCena: 1 },
  },
  { name: 'ułamkowa liczba pracowników (pół etatu)', inputs: { kh: 10, kpir: 40, prac: 2.5, przychod: 400_000, koszty: 250_000 } },
  { name: FLOOR_EDGE_NAME, inputs: FLOOR_EDGE_INPUTS },
];

const withDefaults = (p?: Partial<CalcParams>): CalcParams => ({ ...DEFAULT_PARAMS, ...p });

describe('parytet formuł zakładki „Twoja symulacja” z src/calc', () => {
  it.each(DATASETS)('$name: formuły dają te same wyniki co calculate() i mix()', async ({ inputs, params }) => {
    const sim = await loadSim(inputs, params);
    expect(compareWithCalc(sim, inputs, withDefaults(params))).toEqual([]);
  });

  it.each(DATASETS)('$name: wartości buforowane w pliku zgadzają się z tym, co policzą formuły', async ({ inputs, params }) => {
    const sim = await loadSim(inputs, params);
    const problems: string[] = [];
    for (const row of SIM_ROWS) {
      if (row.kind !== 'formula') continue;
      const formulaValue = sim.get(row.key);
      const cached = sim.cached.get(row.key);
      if (typeof formulaValue === 'number') {
        const m = mismatch(cached, formulaValue);
        if (m) problems.push(`${row.key}: ${m}`);
      } else if (formulaValue === '' && !(cached === '' || cached === undefined)) {
        problems.push(`${row.key}: formuła daje pusty tekst, a w pliku jest ${String(cached)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('po zmianie pól w Excelu formuły liczą nowy stan tak samo jak calculate() (jak u rozmówcy po edycji)', async () => {
    // Plik z przykładu kontrolnego, a następnie „ręczne” wpisanie innych danych w żółte pola.
    const sim = await loadSim(PRZYKLAD_INPUTS);
    for (const { inputs, params, name } of DATASETS) {
      sim.apply(inputs, withDefaults(params));
      expect(compareWithCalc(sim, inputs, withDefaults(params)), name).toEqual([]);
    }
  });

  it('zgodność z arkuszem kalkulator-br na przykładzie kontrolnym (121 h, 36,29 min, +20 KH / +40 KPiR, 137,79 zł/h)', async () => {
    const sim = await loadSim(PRZYKLAD_INPUTS);
    expect(sim.get('godziny')).toBeCloseTo(120.96, 2);
    expect(sim.get('kosztGodziny')).toBeCloseTo(82.67, 2);
    expect(sim.get('minKh')).toBeCloseTo(36.29, 2);
    expect(sim.get('maksKh')).toBe(20);
    expect(sim.get('maksKpir')).toBe(40);
    expect(sim.get('cenaKh')).toBeCloseTo(1111.11, 2);
    expect(sim.get('przychodGodz')).toBeCloseTo(137.79, 2);
    sim.set('mixKhWpis', 10);
    expect(sim.get('mixKpir')).toBe(20);
    expect(sim.get('mixPrzychod')).toBeCloseTo(16_666.67, 2);
  });

  it('kontrola negatywna: zepsuta formuła jest wykrywana (test nie jest pusty)', async () => {
    const sim = await loadSim(PRZYKLAD_INPUTS);
    expect(compareWithCalc(sim, PRZYKLAD_INPUTS, DEFAULT_PARAMS)).toEqual([]);

    // Ktoś „poprawia” wzór kosztu godziny w Excelu bez zmiany src/calc.
    sim.set('kosztGodziny', `=${simCell('kosztMies')}/${simCell('rg')}*1.01` as unknown as Cell);
    const problems = compareWithCalc(sim, PRZYKLAD_INPUTS, DEFAULT_PARAMS);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.startsWith('kosztGodziny') || p.startsWith('godziny'))).toBe(true);
  });

  it('zestaw na granicy floorSafe naprawdę różni zwykłe floor() od floorSafe (zestaw nie jest pusty)', () => {
    const calc = computeCalc(FLOOR_EDGE_INPUTS, DEFAULT_PARAMS)!;
    expect(Math.floor(calc.result.odzyskanyCzasWKlientachKpir)).toBe(17);
    expect(calc.result.maksNowychKpir).toBe(18);
  });

  it('kontrola negatywna: brak epsilona w zaokrągleniu (zwykłe ROUNDDOWN) jest wykrywany na granicy floorSafe', async () => {
    const sim = await loadSim(FLOOR_EDGE_INPUTS);
    expect(compareWithCalc(sim, FLOOR_EDGE_INPUTS, DEFAULT_PARAMS)).toEqual([]);

    sim.set('maksKpir', `=ROUNDDOWN(${simCell('odzyskanyKpir')},0)` as unknown as Cell);
    const problems = compareWithCalc(sim, FLOOR_EDGE_INPUTS, DEFAULT_PARAMS);
    expect(problems.some((p) => p.startsWith('maksKpir'))).toBe(true);
  });
});
