/** Dane pomocnicze do testów Excela (nie jest importowane przez aplikację ani funkcje). */
import { DEFAULT_PARAMS, mix, type CalcParams } from '../calc/calculator.ts';
import { computeCalc, type SessionInputs } from '../session/guestView.ts';
import type { WorkbookInput } from './workbook.ts';

/** Przykład kontrolny z arkusza i specyfikacji: 100 KH, 200 KPiR, 9 osób, 2 mln przychodu, 1,2 mln wynagrodzeń. */
export const PRZYKLAD_INPUTS: SessionInputs = { kh: 100, kpir: 200, prac: 9, przychod: 2_000_000, koszty: 1_200_000 };

export interface FixtureOptions {
  params?: Partial<CalcParams>;
  /** Wybrany miks (KH); domyślnie maksimum. */
  mixKh?: number;
  company?: WorkbookInput['company'];
  createdAt?: Date;
  organizationName?: string;
  accentColor?: string | null;
  consultantName?: string | null;
}

/** Składa wejście budowniczego tak, jak zrobi to serwer: wynik i miks z `src/calc`, nie wpisane z ręki. */
export function makeWorkbookInput(inputs: SessionInputs, options: FixtureOptions = {}): WorkbookInput {
  const params: CalcParams = { ...DEFAULT_PARAMS, ...options.params };
  const calc = computeCalc(inputs, params);
  if (!calc) throw new Error('Dane testowe muszą dawać poprawny wynik');

  return {
    organizationName: options.organizationName ?? 'MITAX Consulting sp. z o.o.',
    accentColor: options.accentColor ?? '#1f6f5c',
    company: options.company ?? { name: 'T-MOBILE POLSKA SPÓŁKA AKCYJNA', nip: '5261040567' },
    consultantName: options.consultantName === undefined ? 'Ola Konsultant' : options.consultantName,
    createdAt: options.createdAt ?? new Date('2026-11-11T12:00:00Z'),
    inputs,
    params,
    result: calc.result,
    mix: mix(calc.result, options.mixKh ?? calc.result.maksNowychKh, calc.wspCzasu),
    calcVersion: calc.result.calcVersion,
  };
}
