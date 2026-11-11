import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../calc/calculator.ts';
import {
  buildGuestView,
  pickMix,
  resolveParams,
  sanitizeInputs,
  toCalcInputs,
  type SessionInputs,
  type SessionRow,
} from './guestView.ts';

/** Przykład kontrolny z arkusza i specyfikacji: 100 KH, 200 KPiR, 9 osób, 2 mln przychodu, 1,2 mln wynagrodzeń. */
const PRZYKLAD: SessionInputs = { kh: 100, kpir: 200, prac: 9, przychod: 2_000_000, koszty: 1_200_000 };

const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  inputs: PRZYKLAD,
  params: {},
  revealed: true,
  mix_kh: null,
  reply: '',
  ...over,
});

describe('sanitizeInputs', () => {
  it('zachowuje dozwolone pola z liczbami i pusty tekst', () => {
    expect(sanitizeInputs({ kh: 100, kpir: '', prac: 9.5, ef: 80, wspCzas: 2, wspCena: 4 })).toEqual({
      kh: 100,
      kpir: '',
      prac: 9.5,
      ef: 80,
      wspCzas: 2,
      wspCena: 4,
    });
  });

  it('odrzuca obce klucze, w tym ciche założenia', () => {
    const out = sanitizeInputs({ kh: 1, celKorzysci: 99999, params: { x: 1 }, __proto__: { kpir: 5 }, evil: 1 });
    expect(out).toEqual({ kh: 1 });
  });

  it('odrzuca wartości niedozwolonego typu i zakresu', () => {
    const out = sanitizeInputs({ kh: '12', kpir: NaN, prac: Infinity, przychod: 1e13, koszty: [1], ef: { a: 1 }, wspCzas: null });
    expect(out).toEqual({});
  });

  it('wejście niebędące obiektem daje pusty wynik', () => {
    for (const v of [null, undefined, 5, 'kh', [1, 2]]) expect(sanitizeInputs(v)).toEqual({});
  });
});

describe('resolveParams', () => {
  it('bez danych — wartości wbudowane', () => {
    expect(resolveParams({})).toEqual(DEFAULT_PARAMS);
    expect(resolveParams(null)).toEqual(DEFAULT_PARAMS);
  });
  it('dodatnie liczby z sesji nadpisują wartości wbudowane', () => {
    expect(resolveParams({ celKorzysci: 15000, dniRobocze: 20 })).toEqual({ ...DEFAULT_PARAMS, celKorzysci: 15000, dniRobocze: 20 });
  });
  it('ignoruje niepoprawne wartości i obce klucze', () => {
    expect(resolveParams({ celKorzysci: -1, dniRobocze: 0, godzinyDziennie: '8', inne: 5 })).toEqual(DEFAULT_PARAMS);
  });
});

describe('toCalcInputs', () => {
  it('brak wymaganego pola → null', () => {
    for (const missing of ['kh', 'kpir', 'prac', 'koszty'] as const) {
      expect(toCalcInputs({ ...PRZYKLAD, [missing]: '' })).toBeNull();
    }
    expect(toCalcInputs({})).toBeNull();
  });
  it('przychód jest opcjonalny', () => {
    expect(toCalcInputs({ ...PRZYKLAD, przychod: '' })?.przychodRok).toBeNull();
    expect(toCalcInputs({ ...PRZYKLAD, przychod: 0 })?.przychodRok).toBeNull();
  });
  it('efektywność z procentów na ułamek; puste i zero → wartość domyślna kalkulatora', () => {
    expect(toCalcInputs({ ...PRZYKLAD, ef: 80 })?.efektywnosc).toBeCloseTo(0.8, 10);
    expect(toCalcInputs({ ...PRZYKLAD, ef: '' })?.efektywnosc).toBeUndefined();
    expect(toCalcInputs({ ...PRZYKLAD, ef: 0 })?.efektywnosc).toBeUndefined();
  });
  it('współczynniki puste lub zerowe → wartość domyślna kalkulatora', () => {
    const c = toCalcInputs({ ...PRZYKLAD, wspCzas: 0, wspCena: '' });
    expect(c?.wspCzasu).toBeUndefined();
    expect(c?.wspCeny).toBeUndefined();
  });
});

describe('buildGuestView', () => {
  it('przed odsłonięciem rozmówca nie dostaje wyniku, nawet przy kompletnych danych', () => {
    const v = buildGuestView(row({ revealed: false }));
    expect(v.revealed).toBe(false);
    expect(v.result).toBeNull();
    expect(v.inputs).toEqual(PRZYKLAD);
  });

  it('po odsłonięciu wynik zgadza się z przykładem kontrolnym (121 h, 36 min, +20 KH / +40 KPiR)', () => {
    const r = buildGuestView(row()).result!;
    expect(r.godzinyDoOdzyskania).toBeCloseTo(120.96, 2);
    expect(r.minutyKhMies).toBeCloseTo(36.29, 2);
    expect(r.minutyKhDzien * 60).toBeCloseTo(103.7, 1);
    expect(r.maksNowychKh).toBe(20);
    expect(r.maksNowychKpir).toBe(40);
    expect(r.hasPrice).toBe(true);
    expect(r.wartoscCzasuMies).toBe(10_000);
  });

  it('warianty miksu: od maksimum KH do zera, 20 KH ≈ 22 222 zł', () => {
    const { mixes } = buildGuestView(row()).result!;
    expect(mixes).toHaveLength(21);
    expect(mixes[0]).toMatchObject({ kh: 20, kpir: 0 });
    expect(mixes[0]!.przychodMies).toBeCloseTo(22_222.2, 1);
    expect(mixes[20]).toMatchObject({ kh: 0, kpir: 40 });
  });

  it('bez przychodu: brak cen, miks bez przychodu', () => {
    const r = buildGuestView(row({ inputs: { ...PRZYKLAD, przychod: '' } })).result!;
    expect(r.hasPrice).toBe(false);
    expect(r.mixes.every((m) => m.przychodMies === null)).toBe(true);
  });

  it('używa założeń sesji (kopia z organizacji)', () => {
    const r = buildGuestView(row({ params: { celKorzysci: 15_000 } })).result!;
    expect(r.godzinyDoOdzyskania).toBeCloseTo(120.96 * 1.5, 2);
    expect(r.wartoscCzasuMies).toBe(15_000);
  });

  it('niekompletne lub niepoprawne dane → brak wyniku, bez wyjątku', () => {
    expect(buildGuestView(row({ inputs: { kh: 100 } })).result).toBeNull();
    expect(buildGuestView(row({ inputs: { ...PRZYKLAD, ef: 150 } })).result).toBeNull(); // efektywność > 100%
    expect(buildGuestView(row({ inputs: { ...PRZYKLAD, kh: -1 } })).result).toBeNull();
    expect(buildGuestView(row({ inputs: { kh: 0, kpir: 0, prac: 9, koszty: 1_200_000 } })).result).toBeNull();
  });

  it('absurdalnie duże dane nie generują ogromnej odpowiedzi', () => {
    const r = buildGuestView(row({ inputs: { kh: 1_000_000, kpir: 0, prac: 9, koszty: 1_200_000 } })).result;
    expect(r).toBeNull();
  });

  it('obce pola zapisane w inputs nie wychodzą do rozmówcy', () => {
    const v = buildGuestView(row({ inputs: { ...PRZYKLAD, secret: 'x', celKorzysci: 1 } as unknown }));
    expect(Object.keys(v.inputs).sort()).toEqual(['kh', 'koszty', 'kpir', 'prac', 'przychod']);
  });

  it('nie ujawnia cichych założeń ani kosztów wewnętrznych: ani params, ani koszt zatrudnienia i godzin', () => {
    const v = buildGuestView(row({ params: { celKorzysci: 12_345, dniRobocze: 19, godzinyDziennie: 7 } }));
    const json = JSON.stringify(v);
    expect(v).not.toHaveProperty('params');
    for (const hidden of ['kosztMies', 'efektywneGodziny', 'kosztGodziny', 'dniRobocze', 'godzinyDziennie', 'celKorzysci']) {
      expect(json).not.toContain(hidden);
    }
  });

  it('przekazuje miks i odpowiedź rozmówcy bez zmian', () => {
    const v = buildGuestView(row({ mix_kh: 7, reply: 'Dzień dobry' }));
    expect(v.mixKh).toBe(7);
    expect(v.reply).toBe('Dzień dobry');
  });
});

describe('pickMix', () => {
  const result = () => buildGuestView(row()).result!;

  it('brak wyboru = maksimum KH', () => {
    expect(pickMix(result(), null)).toMatchObject({ kh: 20, kpir: 0 });
  });
  it('wybrana wartość', () => {
    expect(pickMix(result(), 5)).toMatchObject({ kh: 5, kpir: 30 });
    expect(pickMix(result(), 0)).toMatchObject({ kh: 0, kpir: 40 });
  });
  it('wartości spoza zakresu są przycinane', () => {
    expect(pickMix(result(), 999).kh).toBe(20);
    expect(pickMix(result(), -4).kh).toBe(0);
    expect(pickMix(result(), 7.9).kh).toBe(7);
  });
});
