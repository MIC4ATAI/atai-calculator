import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { SIM_ROWS, simCell, resolveFormula, SIM_FIRST_ROW, type SimKey } from './layout';
import { makeWorkbookInput, PRZYKLAD_INPUTS } from './testFixtures';
import { buildWorkbookBytes, snapshotSheetName, workbookFileName, type WorkbookInput } from './workbook';

async function load(input: WorkbookInput): Promise<ExcelJS.Workbook> {
  const bytes = await buildWorkbookBytes(input);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as never);
  return wb;
}

/** Wartość z kolumny B dla wiersza o danej etykiecie w kolumnie A. */
function valueByLabel(ws: ExcelJS.Worksheet, label: string): ExcelJS.CellValue {
  let found: ExcelJS.CellValue = undefined;
  ws.eachRow((row) => {
    if (row.getCell(1).value === label) found = row.getCell(2).value;
  });
  return found;
}

describe('nazwy zakładek i pliku', () => {
  it('„Kalkulacja z rozmowy (dd.MM.rr)” mieści się w limicie 31 znaków Excela', () => {
    const name = snapshotSheetName(new Date('2026-11-11T12:00:00Z'));
    expect(name).toBe('Kalkulacja z rozmowy (11.11.26)');
    expect(name.length).toBeLessThanOrEqual(31);
  });

  it('data wg czasu polskiego, nie UTC (północ w Warszawie to jeszcze poprzedni dzień w UTC)', () => {
    expect(snapshotSheetName(new Date('2026-12-31T23:30:00Z'))).toBe('Kalkulacja z rozmowy (01.01.27)');
  });

  it('nazwa pliku bez danych osobowych i nazwy firmy', () => {
    expect(workbookFileName(new Date('2026-11-11T12:00:00Z'))).toBe('kalkulacja-2026-11-11.xlsx');
  });
});

describe('plik .xlsx', () => {
  it('to poprawny skoroszyt z dwiema zakładkami we właściwej kolejności', async () => {
    const bytes = await buildWorkbookBytes(makeWorkbookInput(PRZYKLAD_INPUTS));
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe('PK'); // archiwum ZIP (OOXML)

    const wb = await load(makeWorkbookInput(PRZYKLAD_INPUTS));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Kalkulacja z rozmowy (11.11.26)', 'Twoja symulacja']);
  });
});

describe('zakładka 1: kalkulacja z rozmowy (same wartości)', () => {
  it('nie zawiera ani jednej formuły', async () => {
    const ws = (await load(makeWorkbookInput(PRZYKLAD_INPUTS))).worksheets[0]!;
    let formulas = 0;
    ws.eachRow((row) => row.eachCell((cell) => (cell.formula ? (formulas += 1) : 0)));
    expect(formulas).toBe(0);
  });

  it('wartości zgadzają się z przykładem kontrolnym (121 h, 36 min, +20 KH / +40 KPiR)', async () => {
    const ws = (await load(makeWorkbookInput(PRZYKLAD_INPUTS))).worksheets[0]!;
    expect(valueByLabel(ws, 'Godziny do odzyskania / mies.')).toBeCloseTo(120.96, 2);
    expect(valueByLabel(ws, 'Koszt zatrudnienia / mies.')).toBeCloseTo(100_000, 2);
    expect(valueByLabel(ws, 'Minuty / klient KH / mies.')).toBeCloseTo(36.29, 2);
    expect(valueByLabel(ws, 'Maks. nowi klienci KH')).toBe(20);
    expect(valueByLabel(ws, 'Maks. nowi klienci KPiR')).toBe(40);
    expect(valueByLabel(ws, 'Przychód na efektywną godzinę')).toBeCloseTo(137.79, 2);
    expect(valueByLabel(ws, 'Śr. cena klienta KH / mies.')).toBeCloseTo(1111.11, 2);
  });

  it('dane z rozmowy i założenia — także te użyte domyślnie', async () => {
    const ws = (await load(makeWorkbookInput(PRZYKLAD_INPUTS))).worksheets[0]!;
    expect(valueByLabel(ws, 'Klienci – pełna księgowość (KH)')).toBe(100);
    expect(valueByLabel(ws, 'Czas na pracę z klientami')).toBeCloseTo(0.8, 10);
    expect(valueByLabel(ws, 'Czas obsługi KH vs KPiR (× więcej)')).toBe(2);
    expect(valueByLabel(ws, 'Cel korzyści, zł/mies.')).toBe(10_000);
    expect(valueByLabel(ws, 'Dni robocze w miesiącu')).toBe(21);
  });

  it('wybrany w rozmowie miks i wersja logiki', async () => {
    const ws = (await load(makeWorkbookInput(PRZYKLAD_INPUTS, { mixKh: 10 }))).worksheets[0]!;
    expect(valueByLabel(ws, 'Nowi klienci KH')).toBe(10);
    expect(valueByLabel(ws, 'Nowi klienci KPiR')).toBe(20);
    expect(valueByLabel(ws, 'Przychód z nowych klientów / mies.')).toBeCloseTo(16_666.67, 2);
    expect(JSON.stringify(ws.getRows(1, 60)?.map((r) => r.values))).toContain('Wersja logiki obliczeń: 1.1.0');
  });

  it('nagłówek: organizacja, data, firma z NIP-em i konsultant', async () => {
    const ws = (await load(makeWorkbookInput(PRZYKLAD_INPUTS))).worksheets[0]!;
    expect(ws.getCell('A2').value).toBe('MITAX Consulting sp. z o.o. · 11.11.2026');
    expect(ws.getCell('A3').value).toBe('Firma: T-MOBILE POLSKA SPÓŁKA AKCYJNA · NIP 526-104-05-67');
    expect(ws.getCell('A4').value).toBe('Konsultant: Ola Konsultant');
  });

  it('bez przychodu: ceny i przychód to myślnik, a nie zero ani błąd', async () => {
    const ws = (await load(makeWorkbookInput({ ...PRZYKLAD_INPUTS, przychod: '' }))).worksheets[0]!;
    expect(valueByLabel(ws, 'Przychód roczny, zł')).toBe('–');
    expect(valueByLabel(ws, 'Śr. cena klienta KH / mies.')).toBe('–');
    expect(valueByLabel(ws, 'Przychód na efektywną godzinę')).toBe('–');
    expect(valueByLabel(ws, 'Przychód z nowych klientów / mies.')).toBe('–');
    expect(valueByLabel(ws, 'Godziny do odzyskania / mies.')).toBeCloseTo(120.96, 2); // reszta policzona
  });

  it('firma bez nazwy (GUS niedostępny): sam NIP', async () => {
    const ws = (await load(makeWorkbookInput(PRZYKLAD_INPUTS, { company: { name: null, nip: '5261040567' } }))).worksheets[0]!;
    expect(ws.getCell('A3').value).toBe('NIP 526-104-05-67');
  });
});

describe('zakładka 2: Twoja symulacja (formuły)', () => {
  const rowsOf = (kind: 'input' | 'formula') => SIM_ROWS.filter((r) => r.kind === kind) as { key: SimKey }[];

  it('pola wejściowe mają wartości z rozmowy, a nie formuły', async () => {
    const ws = (await load(makeWorkbookInput(PRZYKLAD_INPUTS))).getWorksheet('Twoja symulacja')!;
    expect(ws.getCell(simCell('kh')).value).toBe(100);
    expect(ws.getCell(simCell('kpir')).value).toBe(200);
    expect(ws.getCell(simCell('prac')).value).toBe(9);
    expect(ws.getCell(simCell('przychod')).value).toBe(2_000_000);
    expect(ws.getCell(simCell('ef')).value).toBeCloseTo(0.8, 10);
    expect(ws.getCell(simCell('cel')).value).toBe(10_000);
    expect(ws.getCell(simCell('dni')).value).toBe(21);
    for (const { key } of rowsOf('input')) expect(ws.getCell(simCell(key)).formula).toBeUndefined();
  });

  it('każdy wiersz wyniku to formuła z wartością buforowaną (podglądy bez przeliczania nie pokazują pustych komórek)', async () => {
    const ws = (await load(makeWorkbookInput(PRZYKLAD_INPUTS))).getWorksheet('Twoja symulacja')!;
    for (const { key } of rowsOf('formula')) {
      const cell = ws.getCell(simCell(key));
      expect(cell.formula, `formuła w ${simCell(key)}`).toBeTruthy();
      expect(cell.result, `wartość buforowana w ${simCell(key)}`).not.toBeUndefined();
    }
    expect(ws.getCell(simCell('godziny')).result).toBeCloseTo(120.96, 2);
    expect(ws.getCell(simCell('kosztGodziny')).result).toBeCloseTo(82.67, 2);
    expect(ws.getCell(simCell('maksKh')).result).toBe(20);
    expect(ws.getCell(simCell('przychodGodz')).result).toBeCloseTo(137.79, 2);
  });

  it('formuły odwołują się tylko do komórek wierszy układu (żadnych zabłąkanych adresów)', () => {
    const valid = new Set(Object.keys(Object.fromEntries(SIM_ROWS.filter((r) => r.kind !== 'section').map((r) => [simCell((r as { key: SimKey }).key), 1]))));
    for (const row of SIM_ROWS) {
      if (row.kind !== 'formula') continue;
      const formula = resolveFormula(row.formula);
      expect(formula).not.toContain('{');
      for (const address of formula.match(/\bB\d+\b/g) ?? []) expect(valid.has(address), `${row.key}: ${address}`).toBe(true);
    }
  });

  it('formuła nie odwołuje się do komórki z własnego wiersza ani do późniejszych wyników (brak odwołań cyklicznych)', () => {
    const rowOf = (key: string) => SIM_FIRST_ROW + SIM_ROWS.findIndex((r) => r.kind !== 'section' && r.key === key);
    for (const row of SIM_ROWS) {
      if (row.kind !== 'formula') continue;
      for (const [, dep] of row.formula.matchAll(/\{(\w+)\}/g)) {
        expect(rowOf(dep!), `${row.key} zależy od ${dep}`).toBeLessThan(rowOf(row.key));
      }
    }
  });

  it('bez przychodu: pole przychodu puste, a cena i przychód z miksu mają pustą wartość buforowaną', async () => {
    const ws = (await load(makeWorkbookInput({ ...PRZYKLAD_INPUTS, przychod: '' }))).getWorksheet('Twoja symulacja')!;
    expect(ws.getCell(simCell('przychod')).value).toBeNull();
    // Pusty wynik tekstowy zapisuje się jako <v></v>; ExcelJS wczytuje go jako undefined. Ważne, że to nie liczba.
    for (const key of ['cenaKh', 'cenaKpir', 'przychodGodz', 'mixPrzychod'] as const) {
      const cell = ws.getCell(simCell(key));
      expect(cell.formula, `formuła w ${simCell(key)}`).toContain('IF(');
      expect(['', undefined]).toContain(cell.result);
    }
  });

  it('pola wejściowe mają walidację danych (nie da się wpisać ujemnych klientów ani 0% czasu)', async () => {
    const ws = (await load(makeWorkbookInput(PRZYKLAD_INPUTS))).getWorksheet('Twoja symulacja')!;
    expect(ws.getCell(simCell('kh')).dataValidation?.type).toBe('decimal');
    expect(ws.getCell(simCell('ef')).dataValidation?.operator).toBe('between');
    expect(ws.getCell(simCell('prac')).dataValidation?.operator).toBe('greaterThan');
    expect(ws.getCell(simCell('godziny')).dataValidation).toBeUndefined(); // wynik nie jest do edycji
  });
});

describe('bezpieczeństwo i odporność', () => {
  it('teksty zaczynające się od „=”, „+”, „-”, „@” (np. nazwa firmy z GUS) są zapisane jako tekst, nie formuły', async () => {
    const evil = '=HYPERLINK("http://evil.example","kliknij")';
    const wb = await load(
      makeWorkbookInput(PRZYKLAD_INPUTS, {
        organizationName: '=1+1',
        consultantName: '+SUM(A1:A9)',
        company: { name: evil, nip: '5261040567' },
      }),
    );
    for (const ws of wb.worksheets) {
      ws.eachRow((row) =>
        row.eachCell((cell) => {
          if (typeof cell.value === 'string' || cell.formula === undefined) return;
          // jedyne dozwolone formuły są w zakładce symulacji i pochodzą z układu
          expect(ws.name).toBe('Twoja symulacja');
        }),
      );
    }
    const sheet1 = wb.worksheets[0]!;
    expect(sheet1.getCell('A3').value).toContain(evil);
    expect(sheet1.getCell('A3').formula).toBeUndefined();
    expect(sheet1.getCell('A2').value).toContain('=1+1');
    expect(sheet1.getCell('A2').formula).toBeUndefined();
    expect(sheet1.getCell('A4').formula).toBeUndefined();
  });

  it('kolor marki: poprawny jest użyty, niepoprawny wraca do domyślnego (bez wyjątku)', async () => {
    const fill = async (accentColor: string | null) => {
      const ws = (await load(makeWorkbookInput(PRZYKLAD_INPUTS, { accentColor }))).worksheets[0]!;
      const f = ws.getCell('A6').fill as ExcelJS.FillPattern;
      return f.fgColor?.argb;
    };
    expect(await fill('#336699')).toBe('FF336699');
    expect(await fill('zielony')).toBe('FF1F6F5C');
    expect(await fill('#12345')).toBe('FF1F6F5C');
    expect(await fill(null)).toBe('FF1F6F5C');
  });

  it('niekompletne dane wejściowe snapshotu → czytelny błąd zamiast uszkodzonego pliku', async () => {
    const input = makeWorkbookInput(PRZYKLAD_INPUTS);
    await expect(buildWorkbookBytes({ ...input, inputs: { kh: 100 } })).rejects.toThrow(/kompletnych danych wejściowych/);
  });
});
