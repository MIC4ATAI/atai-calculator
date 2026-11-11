/**
 * Układ zakładki „Twoja symulacja” jako dane: wiersze, etykiety, formaty i formuły.
 * Budowniczy skoroszytu i testy parytetu korzystają z tych samych adresów komórek (`simCell`).
 *
 * Formuły są drugą implementacją wzorów z `src/calc/calculator.ts` — w języku Excela, zgodną z arkuszem
 * „kalkulator-br”. Test parytetu (parity.test.ts) liczy je silnikiem formuł i porównuje z `calculate()`,
 * więc zmiana wzorów w `src/calc` bez zmiany tutaj wywala testy.
 */

export type SimKey =
  // dane od rozmówcy
  | 'kh'
  | 'kpir'
  | 'prac'
  | 'przychod'
  | 'koszty'
  | 'ef'
  | 'wspCzas'
  | 'wspCena'
  // założenia
  | 'cel'
  | 'dni'
  | 'godz'
  // wynik
  | 'kosztMies'
  | 'rg'
  | 'kosztGodziny'
  | 'godziny'
  | 'udzial'
  | 'klienciCzas'
  | 'minKpir'
  | 'minKh'
  | 'minKhDzien'
  | 'odzyskanyKpir'
  | 'maksKh'
  | 'maksKpir'
  | 'klienciCena'
  | 'cenaKpir'
  | 'cenaKh'
  | 'przychodGodz'
  // miks
  | 'mixKhWpis'
  | 'mixKh'
  | 'mixKpir'
  | 'mixPrzychod'
  | 'mixWykorzystanie';

export const FORMATS = {
  int: '#,##0',
  num: '#,##0.##',
  dec1: '#,##0.0',
  dec2: '#,##0.00',
  zl: '#,##0 "zł"',
  zl2: '#,##0.00 "zł"',
  pct0: '0%',
  pct1: '0.0%',
  mult: '0.0',
  h: '#,##0.0 "h"',
  min: '#,##0.0 "min"',
} as const;

export type SimFormat = keyof typeof FORMATS;

/** Walidacja komórki wejściowej w Excelu (żeby nie wpisać bzdur, które dałyby #DZIEL/0!). */
export type SimValidation = 'nonNegative' | 'positive' | 'percent' | 'multiplier';

export type SimRow =
  | { kind: 'section'; label: string }
  | { kind: 'input'; key: SimKey; label: string; format: SimFormat; validation?: SimValidation; note?: string }
  | { kind: 'formula'; key: SimKey; label: string; format: SimFormat; formula: string; note?: string };

/**
 * Formuły używają zapisu `{klucz}` dla adresu komórki innego wiersza. Wzory odpowiadają `calculate()` i `mix()`:
 * `ROUNDDOWN(x+0,000001;0)` to `floorSafe` (zaokrąglenie w dół odporne na błędy zmiennoprzecinkowe).
 */
export const SIM_ROWS: readonly SimRow[] = [
  { kind: 'section', label: 'Dane do kalkulacji (zmień żółte pola)' },
  { kind: 'input', key: 'kh', label: 'Klienci – pełna księgowość (KH)', format: 'int', validation: 'nonNegative' },
  { kind: 'input', key: 'kpir', label: 'Klienci – KPiR / ryczałt', format: 'int', validation: 'nonNegative' },
  { kind: 'input', key: 'prac', label: 'Liczba pracowników', format: 'num', validation: 'positive' },
  {
    kind: 'input',
    key: 'przychod',
    label: 'Przychód roczny, zł',
    format: 'zl',
    validation: 'nonNegative',
    note: 'puste = bez cen i przychodu',
  },
  { kind: 'input', key: 'koszty', label: 'Wynagrodzenia z narzutami, zł/rok', format: 'zl', validation: 'positive' },
  { kind: 'input', key: 'ef', label: 'Czas na pracę z klientami', format: 'pct0', validation: 'percent' },
  { kind: 'input', key: 'wspCzas', label: 'Czas obsługi KH vs KPiR (× więcej)', format: 'mult', validation: 'multiplier' },
  { kind: 'input', key: 'wspCena', label: 'Cena KH vs KPiR (× więcej)', format: 'mult', validation: 'multiplier' },

  { kind: 'section', label: 'Założenia' },
  { kind: 'input', key: 'cel', label: 'Cel korzyści, zł/mies.', format: 'zl', validation: 'positive' },
  { kind: 'input', key: 'dni', label: 'Dni robocze w miesiącu', format: 'num', validation: 'positive' },
  { kind: 'input', key: 'godz', label: 'Godzin pracy dziennie na osobę', format: 'num', validation: 'positive' },

  { kind: 'section', label: 'Wynik (liczy się automatycznie)' },
  { kind: 'formula', key: 'kosztMies', label: 'Koszt zatrudnienia / mies.', format: 'zl2', formula: '{koszty}/12' },
  {
    kind: 'formula',
    key: 'rg',
    label: 'Efektywne roboczogodziny / mies.',
    format: 'dec1',
    formula: '{prac}*{dni}*{godz}*{ef}',
  },
  { kind: 'formula', key: 'kosztGodziny', label: 'Koszt 1 efektywnej godziny', format: 'zl2', formula: '{kosztMies}/{rg}' },
  { kind: 'formula', key: 'godziny', label: 'Godziny do odzyskania / mies.', format: 'h', formula: '{cel}/{kosztGodziny}' },
  { kind: 'formula', key: 'udzial', label: 'Udział w czasie pracy', format: 'pct1', formula: '{godziny}/{rg}' },
  {
    kind: 'formula',
    key: 'klienciCzas',
    label: 'Klienci przeliczeniowi (wg czasu obsługi)',
    format: 'num',
    formula: '{kh}*{wspCzas}+{kpir}',
  },
  {
    kind: 'formula',
    key: 'minKpir',
    label: 'Minuty / klient KPiR / mies.',
    format: 'min',
    formula: '{godziny}/{klienciCzas}*60',
  },
  { kind: 'formula', key: 'minKh', label: 'Minuty / klient KH / mies.', format: 'min', formula: '{minKpir}*{wspCzas}' },
  { kind: 'formula', key: 'minKhDzien', label: 'Minuty / klient KH / dzień', format: 'dec2', formula: '{minKh}/{dni}' },
  {
    kind: 'formula',
    key: 'odzyskanyKpir',
    label: 'Odzyskany czas w klientach KPiR',
    format: 'dec2',
    formula: '{klienciCzas}*{godziny}/{rg}',
  },
  {
    kind: 'formula',
    key: 'maksKh',
    label: 'Maks. nowi klienci KH',
    format: 'int',
    formula: 'ROUNDDOWN({odzyskanyKpir}/{wspCzas}+0.000001,0)',
  },
  {
    kind: 'formula',
    key: 'maksKpir',
    label: 'Maks. nowi klienci KPiR',
    format: 'int',
    formula: 'ROUNDDOWN({odzyskanyKpir}+0.000001,0)',
  },
  {
    kind: 'formula',
    key: 'klienciCena',
    label: 'Klienci przeliczeniowi (wg ceny)',
    format: 'num',
    formula: 'IF({przychod}>0,{kh}*{wspCena}+{kpir},"")',
  },
  {
    kind: 'formula',
    key: 'cenaKpir',
    label: 'Śr. cena klienta KPiR / mies.',
    format: 'zl2',
    formula: 'IF({przychod}>0,{przychod}/12/{klienciCena},"")',
  },
  {
    kind: 'formula',
    key: 'cenaKh',
    label: 'Śr. cena klienta KH / mies.',
    format: 'zl2',
    formula: 'IF({przychod}>0,{cenaKpir}*{wspCena},"")',
  },
  {
    kind: 'formula',
    key: 'przychodGodz',
    label: 'Przychód na efektywną godzinę',
    format: 'zl2',
    formula: 'IF({przychod}>0,{przychod}/12/{rg},"")',
  },

  { kind: 'section', label: 'Miks nowych klientów' },
  {
    kind: 'input',
    key: 'mixKhWpis',
    label: 'Nowi klienci KH (od 0 do maksimum)',
    format: 'int',
    validation: 'nonNegative',
    note: 'reszta czasu wypełniają klienci KPiR',
  },
  {
    kind: 'formula',
    key: 'mixKh',
    label: 'Nowi klienci KH (po uwzględnieniu maksimum)',
    format: 'int',
    formula: 'MAX(0,MIN(ROUNDDOWN({mixKhWpis},0),{maksKh}))',
  },
  {
    kind: 'formula',
    key: 'mixKpir',
    label: 'Nowi klienci KPiR',
    format: 'int',
    formula: 'ROUNDDOWN({odzyskanyKpir}-{mixKh}*{wspCzas}+0.000001,0)',
  },
  {
    kind: 'formula',
    key: 'mixPrzychod',
    label: 'Przychód z nowych klientów / mies.',
    format: 'zl2',
    formula: 'IF({przychod}>0,{mixKh}*{cenaKh}+{mixKpir}*{cenaKpir},"")',
  },
  {
    kind: 'formula',
    key: 'mixWykorzystanie',
    label: 'Wykorzystanie odzyskanego czasu',
    format: 'pct0',
    formula: '({mixKh}*{wspCzas}+{mixKpir})/{odzyskanyKpir}',
  },
];

/** Pierwszy wiersz z danymi w zakładce „Twoja symulacja” (wiersze 1–2: tytuł i podpowiedź). */
export const SIM_FIRST_ROW = 4;
/** Kolumny: A etykiety, B wartości i formuły, C uwagi. */
export const SIM_VALUE_COL = 'B';

/** Numer wiersza dla każdego klucza. */
export const SIM_ROW_NUMBERS: Readonly<Record<SimKey, number>> = (() => {
  const out = {} as Record<SimKey, number>;
  SIM_ROWS.forEach((row, i) => {
    if (row.kind !== 'section') out[row.key] = SIM_FIRST_ROW + i;
  });
  return out;
})();

/** Adres komórki z wartością, np. simCell('kh') → 'B5'. */
export function simCell(key: SimKey): string {
  return `${SIM_VALUE_COL}${SIM_ROW_NUMBERS[key]}`;
}

/** Formuła z podstawionymi adresami komórek (bez wiodącego „=”, jak w ExcelJS). */
export function resolveFormula(template: string): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (!(key in SIM_ROW_NUMBERS)) throw new Error(`Nieznany klucz w formule: ${key}`);
    return simCell(key as SimKey);
  });
}
