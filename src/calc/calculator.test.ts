import { describe, expect, it } from 'vitest';
import { allMixes, calculate, CalcInputError, CALC_VERSION, mix } from './calculator';
import { isValidNip } from './nip';

/**
 * Dane przykładowe z arkusza „kalkulator-br”. Oczekiwane wartości pochodzą
 * z arkusza — test pilnuje zgodności aplikacji z arkuszem.
 */
const PRZYKLAD = {
  kh: 100,
  kpir: 200,
  pracownicy: 9,
  przychodRok: 2_000_000,
  kosztyWynagrodzenRok: 1_200_000,
};

describe('calculate — zgodność z arkuszem kalkulator-br', () => {
  const r = calculate(PRZYKLAD);

  it('zapisuje wersję logiki', () => {
    expect(r.calcVersion).toBe(CALC_VERSION);
  });

  it('koszt i godziny', () => {
    expect(r.kosztMies).toBeCloseTo(100_000, 2);
    expect(r.efektywneGodziny).toBeCloseTo(1209.6, 6);
    expect(r.kosztGodziny).toBeCloseTo(82.67, 2);
    expect(r.godzinyDoOdzyskania).toBeCloseTo(120.96, 2);
    expect(r.udzialCzasu).toBeCloseTo(0.1, 6);
  });

  it('minuty na klienta', () => {
    expect(r.minutyKhMies).toBeCloseTo(36.29, 2);
    expect(r.minutyKpirMies).toBeCloseTo(18.14, 2);
    // 36,29 min / 21 dni ≈ 1 min 44 s dziennie
    expect(r.minutyKhDzien * 60).toBeCloseTo(103.7, 1);
  });

  it('ceny i maksymalni nowi klienci', () => {
    expect(r.cenaKh).toBeCloseTo(1111.11, 2);
    expect(r.cenaKpir).toBeCloseTo(277.78, 2);
    expect(r.maksNowychKh).toBe(20);
    expect(r.maksNowychKpir).toBe(40);
  });

  // Arkusz „kalkulator-br”: zł/h w wierszu „przychód” = C4/C14 (rocznie) i D4/D14 (miesięcznie) = 137,79.
  it('przychód na efektywną godzinę (arkusz: 137,79 zł/h)', () => {
    expect(r.przychodNaGodzine).toBeCloseTo(137.79, 2);
    // ten sam wynik rocznie i miesięcznie, jak w arkuszu
    expect(r.przychodNaGodzine! * r.efektywneGodziny * 12).toBeCloseTo(PRZYKLAD.przychodRok, 2);
  });

  it('bez przychodu nie liczy przychodu na godzinę', () => {
    expect(calculate({ ...PRZYKLAD, przychodRok: null }).przychodNaGodzine).toBeNull();
    expect(calculate({ ...PRZYKLAD, przychodRok: 0 }).przychodNaGodzine).toBeNull();
    expect(calculate({ ...PRZYKLAD, przychodRok: undefined }).przychodNaGodzine).toBeNull();
  });

  it('wersja logiki: 1.1.0 (dodano przychód na godzinę)', () => {
    expect(CALC_VERSION).toBe('1.1.0');
  });
});

describe('mix — suwak miksu nowych klientów', () => {
  const r = calculate(PRZYKLAD);

  it.each([
    [20, 0, 22_222.22],
    [19, 2, 21_666.67],
    [10, 20, 16_666.67],
    [0, 40, 11_111.11],
  ])('%i KH → %i KPiR, przychód %f zł', (kh, kpir, przychod) => {
    const m = mix(r, kh);
    expect(m.kh).toBe(kh);
    expect(m.kpir).toBe(kpir);
    expect(m.przychodMies).toBeCloseTo(przychod, 2);
    expect(m.wykorzystanieCzasu).toBeCloseTo(1, 6);
  });

  it('obcina wartości spoza zakresu', () => {
    expect(mix(r, 99).kh).toBe(20);
    expect(mix(r, -5).kh).toBe(0);
  });

  it('allMixes daje 21 wariantów od 20 do 0 KH', () => {
    const all = allMixes(r);
    expect(all).toHaveLength(21);
    expect(all[0].kh).toBe(20);
    expect(all[20].kh).toBe(0);
  });

  it('bez przychodu nie liczy cen ani przychodu', () => {
    const bez = calculate({ ...PRZYKLAD, przychodRok: null });
    expect(bez.cenaKh).toBeNull();
    expect(mix(bez, 10).przychodMies).toBeNull();
    expect(bez.maksNowychKh).toBe(20);
  });
});

describe('calculate — walidacja danych', () => {
  it.each([
    [{ ...PRZYKLAD, pracownicy: 0 }],
    [{ ...PRZYKLAD, kosztyWynagrodzenRok: 0 }],
    [{ ...PRZYKLAD, kh: 0, kpir: 0 }],
    [{ ...PRZYKLAD, kh: -1 }],
    [{ ...PRZYKLAD, efektywnosc: 1.5 }],
  ])('odrzuca błędne dane %#', (inputs) => {
    expect(() => calculate(inputs)).toThrow(CalcInputError);
  });
});

describe('isValidNip', () => {
  it('przyjmuje poprawny NIP w różnych zapisach', () => {
    expect(isValidNip('5261040828')).toBe(true);
    expect(isValidNip('526-104-08-28')).toBe(true);
    expect(isValidNip('PL 526 104 08 28')).toBe(true);
  });

  it('odrzuca błędną sumę kontrolną i zły format', () => {
    expect(isValidNip('5261040827')).toBe(false);
    expect(isValidNip('123')).toBe(false);
    expect(isValidNip('abcdefghij')).toBe(false);
  });
});
