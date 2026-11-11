/**
 * Logika kalkulatora efektywności biura rachunkowego.
 *
 * Źródło prawdy: arkusz „kalkulator-br” (Google Sheets) Marka Kustosza.
 * Każda zmiana wzorów wymaga podbicia CALC_VERSION, bo zamrożone stany
 * sesji (calc_snapshots) zapisują wersję logiki, którą policzono wynik.
 */

/**
 * Wersja logiki zapisywana w zamrożonych stanach sesji. Historia:
 *  - 1.1.0: dodano `przychodNaGodzine` (arkusz: zł/h = przychód / rg); istniejące wzory bez zmian.
 *  - 1.0.0: wersja początkowa.
 */
export const CALC_VERSION = '1.1.0';

/** Dane podawane przez rozmówcę (lub podpowiadane przez konsultanta). */
export interface CalcInputs {
  /** Liczba klientów z pełną księgowością (KH). */
  kh: number;
  /** Liczba klientów KPiR / ryczałt. */
  kpir: number;
  /** Liczba pracowników. */
  pracownicy: number;
  /** Roczne koszty wynagrodzeń z narzutami, zł. */
  kosztyWynagrodzenRok: number;
  /** Roczny przychód, zł. Opcjonalny: bez niego nie liczymy cen ani przychodu z miksu. */
  przychodRok?: number | null;
  /** Część czasu pracy poświęcana klientom i dokumentom, 0–1. Domyślnie 0,8. */
  efektywnosc?: number;
  /** Ile razy dłużej trwa obsługa klienta KH niż KPiR. Domyślnie 2. */
  wspCzasu?: number;
  /** Ile razy droższa jest obsługa klienta KH niż KPiR. Domyślnie 4. */
  wspCeny?: number;
}

/** Ciche założenia ustawiane przez konsultanta / organizację. */
export interface CalcParams {
  /** Miesięczny cel korzyści, zł. */
  celKorzysci: number;
  /** Dni robocze w miesiącu. */
  dniRobocze: number;
  /** Nominalne godziny pracy na osobę dziennie. */
  godzinyDziennie: number;
}

export const DEFAULT_INPUTS = { efektywnosc: 0.8, wspCzasu: 2, wspCeny: 4 } as const;
export const DEFAULT_PARAMS: CalcParams = { celKorzysci: 10_000, dniRobocze: 21, godzinyDziennie: 8 };

export interface CalcResult {
  calcVersion: string;
  /** Koszt zatrudnienia miesięcznie, zł. */
  kosztMies: number;
  /** Efektywne roboczogodziny miesięcznie. */
  efektywneGodziny: number;
  /** Koszt jednej efektywnej godziny pracy, zł. */
  kosztGodziny: number;
  /** Godziny miesięcznie odpowiadające celowi korzyści. */
  godzinyDoOdzyskania: number;
  /** Udział odzyskanych godzin w efektywnym czasie pracy, 0–1. */
  udzialCzasu: number;
  /** Minuty miesięcznie do zaoszczędzenia na kliencie KH. */
  minutyKhMies: number;
  /** Minuty miesięcznie do zaoszczędzenia na kliencie KPiR. */
  minutyKpirMies: number;
  /** Minuty dziennie na kliencie KH. */
  minutyKhDzien: number;
  /** Odzyskany czas wyrażony w liczbie klientów KPiR (ułamkowo). */
  odzyskanyCzasWKlientachKpir: number;
  /** Maksymalna liczba nowych klientów KH (całkowita). */
  maksNowychKh: number;
  /** Maksymalna liczba nowych klientów KPiR (całkowita). */
  maksNowychKpir: number;
  /** Średnia cena miesięczna klienta KH, zł (null bez przychodu). */
  cenaKh: number | null;
  /** Średnia cena miesięczna klienta KPiR, zł (null bez przychodu). */
  cenaKpir: number | null;
  /** Przychód na jedną efektywną godzinę pracy, zł/h (arkusz: przychód / rg; null bez przychodu). */
  przychodNaGodzine: number | null;
}

export interface MixResult {
  kh: number;
  kpir: number;
  /** Przychód miesięczny z nowych klientów, zł (null bez przychodu). */
  przychodMies: number | null;
  /** Wykorzystanie odzyskanego czasu, 0–1. */
  wykorzystanieCzasu: number;
}

/** Zaokrąglenie w dół odporne na błędy zmiennoprzecinkowe (39.9999999 → 40). */
const floorSafe = (x: number): number => Math.floor(x + 1e-6);

export class CalcInputError extends Error {}

function assertPositive(name: string, v: number) {
  if (!Number.isFinite(v) || v <= 0) throw new CalcInputError(`${name} musi być liczbą dodatnią`);
}
function assertNonNegative(name: string, v: number) {
  if (!Number.isFinite(v) || v < 0) throw new CalcInputError(`${name} nie może być ujemne`);
}

export function calculate(inputs: CalcInputs, params: CalcParams = DEFAULT_PARAMS): CalcResult {
  const efektywnosc = inputs.efektywnosc ?? DEFAULT_INPUTS.efektywnosc;
  const wspCzasu = inputs.wspCzasu ?? DEFAULT_INPUTS.wspCzasu;
  const wspCeny = inputs.wspCeny ?? DEFAULT_INPUTS.wspCeny;

  assertNonNegative('Liczba klientów KH', inputs.kh);
  assertNonNegative('Liczba klientów KPiR', inputs.kpir);
  if (inputs.kh + inputs.kpir <= 0) throw new CalcInputError('Biuro musi mieć co najmniej jednego klienta');
  assertPositive('Liczba pracowników', inputs.pracownicy);
  assertPositive('Koszty wynagrodzeń', inputs.kosztyWynagrodzenRok);
  if (!(efektywnosc > 0 && efektywnosc <= 1)) throw new CalcInputError('Efektywność musi być w przedziale (0, 1]');
  assertPositive('Współczynnik czasu', wspCzasu);
  assertPositive('Współczynnik ceny', wspCeny);
  assertPositive('Cel korzyści', params.celKorzysci);
  assertPositive('Dni robocze', params.dniRobocze);
  assertPositive('Godziny dziennie', params.godzinyDziennie);

  const kosztMies = inputs.kosztyWynagrodzenRok / 12;
  const efektywneGodziny = inputs.pracownicy * params.dniRobocze * params.godzinyDziennie * efektywnosc;
  const kosztGodziny = kosztMies / efektywneGodziny;
  const godzinyDoOdzyskania = params.celKorzysci / kosztGodziny;

  // Klienci przeliczeniowi według czasu obsługi (1 KPiR = 1, 1 KH = wspCzasu).
  const klienciCzasowi = inputs.kh * wspCzasu + inputs.kpir;
  const minutyKpirMies = (godzinyDoOdzyskania / klienciCzasowi) * 60;
  const minutyKhMies = minutyKpirMies * wspCzasu;

  const odzyskanyCzasWKlientachKpir = (klienciCzasowi * godzinyDoOdzyskania) / efektywneGodziny;

  let cenaKh: number | null = null;
  let cenaKpir: number | null = null;
  let przychodNaGodzine: number | null = null;
  if (inputs.przychodRok != null && inputs.przychodRok > 0) {
    przychodNaGodzine = inputs.przychodRok / 12 / efektywneGodziny;
    // Klienci przeliczeniowi według ceny (1 KPiR = 1, 1 KH = wspCeny).
    const klienciCenowi = inputs.kh * wspCeny + inputs.kpir;
    cenaKpir = inputs.przychodRok / 12 / klienciCenowi;
    cenaKh = cenaKpir * wspCeny;
  }

  return {
    calcVersion: CALC_VERSION,
    kosztMies,
    efektywneGodziny,
    kosztGodziny,
    godzinyDoOdzyskania,
    udzialCzasu: godzinyDoOdzyskania / efektywneGodziny,
    minutyKhMies,
    minutyKpirMies,
    minutyKhDzien: minutyKhMies / params.dniRobocze,
    odzyskanyCzasWKlientachKpir,
    maksNowychKh: floorSafe(odzyskanyCzasWKlientachKpir / wspCzasu),
    maksNowychKpir: floorSafe(odzyskanyCzasWKlientachKpir),
    cenaKh,
    cenaKpir,
    przychodNaGodzine,
  };
}

/**
 * Miks nowych klientów dla wybranej liczby klientów KH (suwak).
 * Pozostały odzyskany czas wypełniają klienci KPiR.
 */
export function mix(result: CalcResult, nowiKh: number, wspCzasu: number = DEFAULT_INPUTS.wspCzasu): MixResult {
  const kh = Math.max(0, Math.min(Math.floor(nowiKh), result.maksNowychKh));
  const kpir = floorSafe(result.odzyskanyCzasWKlientachKpir - kh * wspCzasu);
  const przychodMies =
    result.cenaKh != null && result.cenaKpir != null ? kh * result.cenaKh + kpir * result.cenaKpir : null;
  return {
    kh,
    kpir,
    przychodMies,
    wykorzystanieCzasu: (kh * wspCzasu + kpir) / result.odzyskanyCzasWKlientachKpir,
  };
}

/** Wszystkie warianty miksu od maksimum KH do zera (tabela „Miks klientów”). */
export function allMixes(result: CalcResult, wspCzasu: number = DEFAULT_INPUTS.wspCzasu): MixResult[] {
  const out: MixResult[] = [];
  for (let kh = result.maksNowychKh; kh >= 0; kh--) out.push(mix(result, kh, wspCzasu));
  return out;
}
