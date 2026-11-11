/**
 * Excel z kalkulacją dla rozmówcy, budowany ze snapshotu (zamrożonego stanu sesji). Czysta funkcja:
 * dane wejściowe → bajty pliku .xlsx. Działa w Node (testy) i w Deno (Edge Function), dlatego importy mają
 * rozszerzenie .ts, a `exceljs` jest podawany jako „bare specifier” (w Deno mapuje go deno.json funkcji).
 *
 * Dwie zakładki (spec, „Zamrożenie stanu sesji przy CTA”):
 *  1. „Kalkulacja z rozmowy (dd.MM.rr)” — same wartości ze snapshotu, bez formuł;
 *  2. „Twoja symulacja” — działające formuły (layout.ts) z wartościami początkowymi z rozmowy.
 *
 * Konsekwencja: żeby formuły działały, ciche założenia (cel korzyści, dni, godziny) są w Excelu jawnymi
 * komórkami. Rozmówca zobaczy je po CTA.
 */
import ExcelJS from 'exceljs';
import { DEFAULT_INPUTS, type CalcParams, type CalcResult, type MixResult } from '../calc/calculator.ts';
import { formatNip } from '../company/companyView.ts';
import { toCalcInputs, type SessionInputs } from '../session/guestView.ts';
import {
  FORMATS,
  resolveFormula,
  SIM_FIRST_ROW,
  SIM_ROWS,
  simCell,
  type SimFormat,
  type SimKey,
  type SimValidation,
} from './layout.ts';

export interface WorkbookInput {
  organizationName: string;
  /** Kolor marki organizacji, np. „#1f6f5c”; niepoprawny lub brak → domyślny. */
  accentColor?: string | null;
  company: { name: string | null; nip: string };
  consultantName?: string | null;
  /** Moment zamrożenia stanu (calc_snapshots.created_at). */
  createdAt: Date;
  inputs: SessionInputs;
  params: CalcParams;
  result: CalcResult;
  /** Wariant miksu wybrany w rozmowie. */
  mix: MixResult;
  calcVersion: string;
}

const TIME_ZONE = 'Europe/Warsaw';
const DEFAULT_ACCENT = '1F6F5C';
const INPUT_FILL = 'FFFFF2CC';
const SIM_SHEET_NAME = 'Twoja symulacja';

// ---------------------------------------------------------------------------
// Daty i nazwy
// ---------------------------------------------------------------------------
function dateParts(date: Date): { dd: string; mm: string; yyyy: string } {
  const parts = new Intl.DateTimeFormat('pl-PL', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { dd: get('day'), mm: get('month'), yyyy: get('year') };
}

/** „Kalkulacja z rozmowy (11.11.26)” — dd.MM.rr mieści się w limicie 31 znaków nazwy zakładki w Excelu. */
export function snapshotSheetName(date: Date): string {
  const { dd, mm, yyyy } = dateParts(date);
  return `Kalkulacja z rozmowy (${dd}.${mm}.${yyyy.slice(-2)})`;
}

/** Nazwa pliku do załącznika; bez danych osobowych ani nazwy firmy. */
export function workbookFileName(date: Date): string {
  const { dd, mm, yyyy } = dateParts(date);
  return `kalkulacja-${yyyy}-${mm}-${dd}.xlsx`;
}

function formatDatePl(date: Date): string {
  const { dd, mm, yyyy } = dateParts(date);
  return `${dd}.${mm}.${yyyy}`;
}

function accentArgb(color: string | null | undefined): string {
  const match = typeof color === 'string' ? /^#?([0-9a-fA-F]{6})$/.exec(color.trim()) : null;
  return `FF${(match?.[1] ?? DEFAULT_ACCENT).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Dane efektywne (z wartościami domyślnymi użytymi w obliczeniach)
// ---------------------------------------------------------------------------
interface EffectiveInputs {
  kh: number;
  kpir: number;
  prac: number;
  przychod: number | null;
  koszty: number;
  /** Ułamek, np. 0,8. */
  ef: number;
  wspCzas: number;
  wspCena: number;
}

function effectiveInputs(inputs: SessionInputs): EffectiveInputs {
  const c = toCalcInputs(inputs);
  if (!c) throw new Error('Snapshot nie ma kompletnych danych wejściowych');
  return {
    kh: c.kh,
    kpir: c.kpir,
    prac: c.pracownicy,
    przychod: c.przychodRok ?? null,
    koszty: c.kosztyWynagrodzenRok,
    ef: c.efektywnosc ?? DEFAULT_INPUTS.efektywnosc,
    wspCzas: c.wspCzasu ?? DEFAULT_INPUTS.wspCzasu,
    wspCena: c.wspCeny ?? DEFAULT_INPUTS.wspCeny,
  };
}

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------
const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
  left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
  bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
  right: { style: 'thin', color: { argb: 'FFD9D9D9' } },
};

function styleTitle(ws: ExcelJS.Worksheet, accent: string, text: string, subtitle?: string): void {
  ws.getCell('A1').value = text;
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: accent } };
  if (subtitle) {
    ws.getCell('A2').value = subtitle;
    ws.getCell('A2').font = { size: 10, color: { argb: 'FF666666' } };
  }
}

function styleSection(ws: ExcelJS.Worksheet, row: number, accent: string, label: string): void {
  for (const col of ['A', 'B', 'C']) {
    ws.getCell(`${col}${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: accent } };
  }
  const cell = ws.getCell(`A${row}`);
  cell.value = label;
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
}

function setWidths(ws: ExcelJS.Worksheet): void {
  ws.getColumn('A').width = 46;
  ws.getColumn('B').width = 22;
  ws.getColumn('C').width = 36;
}

// ---------------------------------------------------------------------------
// Zakładka 1: wartości z rozmowy
// ---------------------------------------------------------------------------
type ValueRow = [label: string, value: number | string, format?: SimFormat];

function buildSnapshotSheet(wb: ExcelJS.Workbook, input: WorkbookInput, accent: string): void {
  const ws = wb.addWorksheet(snapshotSheetName(input.createdAt), { views: [{ showGridLines: false }] });
  setWidths(ws);

  const e = effectiveInputs(input.inputs);
  const r = input.result;
  const p = input.params;
  const none = '–';

  styleTitle(ws, accent, 'Kalkulacja z rozmowy', `${input.organizationName} · ${formatDatePl(input.createdAt)}`);
  const company = input.company.name
    ? `Firma: ${input.company.name} · NIP ${formatNip(input.company.nip)}`
    : `NIP ${formatNip(input.company.nip)}`;
  ws.getCell('A3').value = company;
  ws.getCell('A3').font = { size: 10, color: { argb: 'FF666666' } };
  if (input.consultantName) {
    ws.getCell('A4').value = `Konsultant: ${input.consultantName}`;
    ws.getCell('A4').font = { size: 10, color: { argb: 'FF666666' } };
  }

  const sections: { title: string; rows: ValueRow[] }[] = [
    {
      title: 'Dane z rozmowy',
      rows: [
        ['Klienci – pełna księgowość (KH)', e.kh, 'int'],
        ['Klienci – KPiR / ryczałt', e.kpir, 'int'],
        ['Liczba pracowników', e.prac, 'num'],
        ['Przychód roczny, zł', e.przychod ?? none, 'zl'],
        ['Wynagrodzenia z narzutami, zł/rok', e.koszty, 'zl'],
        ['Czas na pracę z klientami', e.ef, 'pct0'],
        ['Czas obsługi KH vs KPiR (× więcej)', e.wspCzas, 'mult'],
        ['Cena KH vs KPiR (× więcej)', e.wspCena, 'mult'],
      ],
    },
    {
      title: 'Założenia',
      rows: [
        ['Cel korzyści, zł/mies.', p.celKorzysci, 'zl'],
        ['Dni robocze w miesiącu', p.dniRobocze, 'num'],
        ['Godzin pracy dziennie na osobę', p.godzinyDziennie, 'num'],
      ],
    },
    {
      title: 'Wynik',
      rows: [
        ['Koszt zatrudnienia / mies.', r.kosztMies, 'zl2'],
        ['Efektywne roboczogodziny / mies.', r.efektywneGodziny, 'dec1'],
        ['Koszt 1 efektywnej godziny', r.kosztGodziny, 'zl2'],
        ['Godziny do odzyskania / mies.', r.godzinyDoOdzyskania, 'h'],
        ['Udział w czasie pracy', r.udzialCzasu, 'pct1'],
        ['Minuty / klient KH / mies.', r.minutyKhMies, 'min'],
        ['Minuty / klient KPiR / mies.', r.minutyKpirMies, 'min'],
        ['Minuty / klient KH / dzień', r.minutyKhDzien, 'dec2'],
        ['Maks. nowi klienci KH', r.maksNowychKh, 'int'],
        ['Maks. nowi klienci KPiR', r.maksNowychKpir, 'int'],
        ['Śr. cena klienta KH / mies.', r.cenaKh ?? none, 'zl2'],
        ['Śr. cena klienta KPiR / mies.', r.cenaKpir ?? none, 'zl2'],
        ['Przychód na efektywną godzinę', r.przychodNaGodzine ?? none, 'zl2'],
      ],
    },
    {
      title: 'Miks nowych klientów wybrany w rozmowie',
      rows: [
        ['Nowi klienci KH', input.mix.kh, 'int'],
        ['Nowi klienci KPiR', input.mix.kpir, 'int'],
        ['Przychód z nowych klientów / mies.', input.mix.przychodMies ?? none, 'zl2'],
        ['Wykorzystanie odzyskanego czasu', input.mix.wykorzystanieCzasu, 'pct0'],
      ],
    },
  ];

  let row = 6;
  for (const section of sections) {
    styleSection(ws, row, accent, section.title);
    row += 1;
    for (const [label, value, format] of section.rows) {
      ws.getCell(`A${row}`).value = label;
      const cell = ws.getCell(`B${row}`);
      cell.value = value; // liczba lub tekst — nigdy formuła
      cell.alignment = { horizontal: 'right' };
      if (format && typeof value === 'number') cell.numFmt = FORMATS[format];
      for (const col of ['A', 'B']) ws.getCell(`${col}${row}`).border = thinBorder;
      row += 1;
    }
    row += 1;
  }

  ws.getCell(`A${row}`).value = `Wersja logiki obliczeń: ${input.calcVersion}`;
  ws.getCell(`A${row}`).font = { size: 9, color: { argb: 'FF888888' } };
}

// ---------------------------------------------------------------------------
// Zakładka 2: „Twoja symulacja” (formuły)
// ---------------------------------------------------------------------------
type CellValue = number | string;

/** Wartości początkowe komórek: wejścia z rozmowy i buforowane wyniki formuł (te same dane, więc bez przeliczania). */
function simulationValues(input: WorkbookInput): Record<SimKey, CellValue> {
  const e = effectiveInputs(input.inputs);
  const r = input.result;
  const p = input.params;
  const blank = '';
  const priced = e.przychod !== null;

  return {
    kh: e.kh,
    kpir: e.kpir,
    prac: e.prac,
    przychod: e.przychod ?? blank,
    koszty: e.koszty,
    ef: e.ef,
    wspCzas: e.wspCzas,
    wspCena: e.wspCena,
    cel: p.celKorzysci,
    dni: p.dniRobocze,
    godz: p.godzinyDziennie,
    kosztMies: r.kosztMies,
    rg: r.efektywneGodziny,
    kosztGodziny: r.kosztGodziny,
    godziny: r.godzinyDoOdzyskania,
    udzial: r.udzialCzasu,
    klienciCzas: e.kh * e.wspCzas + e.kpir,
    minKpir: r.minutyKpirMies,
    minKh: r.minutyKhMies,
    minKhDzien: r.minutyKhDzien,
    odzyskanyKpir: r.odzyskanyCzasWKlientachKpir,
    maksKh: r.maksNowychKh,
    maksKpir: r.maksNowychKpir,
    klienciCena: priced ? e.kh * e.wspCena + e.kpir : blank,
    cenaKpir: r.cenaKpir ?? blank,
    cenaKh: r.cenaKh ?? blank,
    przychodGodz: r.przychodNaGodzine ?? blank,
    mixKhWpis: input.mix.kh,
    mixKh: input.mix.kh,
    mixKpir: input.mix.kpir,
    mixPrzychod: input.mix.przychodMies ?? blank,
    mixWykorzystanie: input.mix.wykorzystanieCzasu,
  };
}

function validationFor(kind: SimValidation): ExcelJS.DataValidation {
  const base = { allowBlank: true, showErrorMessage: true, errorStyle: 'stop' as const, errorTitle: 'Niepoprawna wartość' };
  switch (kind) {
    case 'nonNegative':
      return { ...base, type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], error: 'Wpisz liczbę nie mniejszą niż 0.' };
    case 'positive':
      return { ...base, type: 'decimal', operator: 'greaterThan', formulae: [0], error: 'Wpisz liczbę większą od 0.' };
    case 'percent':
      return { ...base, type: 'decimal', operator: 'between', formulae: [0.01, 1], error: 'Wpisz wartość od 1% do 100%.' };
    case 'multiplier':
      return { ...base, type: 'decimal', operator: 'greaterThan', formulae: [0], error: 'Wpisz liczbę większą od 0.' };
  }
}

function buildSimulationSheet(wb: ExcelJS.Workbook, input: WorkbookInput, accent: string): void {
  const ws = wb.addWorksheet(SIM_SHEET_NAME, { views: [{ showGridLines: false }] });
  setWidths(ws);
  styleTitle(
    ws,
    accent,
    'Twoja symulacja',
    'Zmień żółte pola — wyniki przeliczą się automatycznie. Wartości początkowe pochodzą z rozmowy.',
  );

  const values = simulationValues(input);

  SIM_ROWS.forEach((row, i) => {
    const r = SIM_FIRST_ROW + i;
    if (row.kind === 'section') {
      styleSection(ws, r, accent, row.label);
      return;
    }

    ws.getCell(`A${r}`).value = row.label;
    const cell = ws.getCell(simCell(row.key));
    cell.numFmt = FORMATS[row.format];
    cell.alignment = { horizontal: 'right' };
    cell.border = thinBorder;
    ws.getCell(`A${r}`).border = thinBorder;

    if (row.kind === 'input') {
      cell.value = values[row.key] === '' ? null : values[row.key];
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_FILL } };
      if (row.validation) cell.dataValidation = validationFor(row.validation);
    } else {
      cell.value = { formula: resolveFormula(row.formula), result: values[row.key] };
    }

    if (row.note) {
      ws.getCell(`C${r}`).value = row.note;
      ws.getCell(`C${r}`).font = { italic: true, size: 9, color: { argb: 'FF888888' } };
    }
  });
}

// ---------------------------------------------------------------------------
// Wejście publiczne
// ---------------------------------------------------------------------------
/** Buduje plik .xlsx ze snapshotu. Rzuca błąd, gdy dane wejściowe snapshotu są niekompletne. */
export async function buildWorkbookBytes(input: WorkbookInput): Promise<Uint8Array> {
  const accent = accentArgb(input.accentColor);
  const wb = new ExcelJS.Workbook();
  wb.creator = input.organizationName;
  wb.created = input.createdAt;
  wb.modified = input.createdAt;

  buildSnapshotSheet(wb, input, accent);
  buildSimulationSheet(wb, input, accent);

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
