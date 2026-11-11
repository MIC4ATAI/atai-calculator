/**
 * Zadanie „wyślij kalkulację” (krok CTA) jako czyste funkcje: wiersze z bazy → wejście dla Excela i maila.
 * Edge Function `request-calculation` tylko czyta dane, woła te funkcje i wysyła; cała logika decyzyjna jest tu,
 * więc da się ją przetestować w Vitest.
 *
 * Najważniejsza zasada: Excel i mail powstają ZE SNAPSHOTU (zamrożony stan z rozmowy), nigdy z żywej sesji.
 * Dzięki temu ponowna wysyłka po zmianach rozmówcy nadal przesyła to, co ustalono w rozmowie.
 */
import { mix, type CalcParams, type CalcResult, type MixResult } from '../calc/calculator.ts';
import { parseBrand } from '../email/brand.ts';
import { buildCalculationMessage, type MailAddress, type MailMessage } from '../email/message.ts';
import { renderCalculationEmail, type EmailInput } from '../email/template.ts';
import { buildWorkbookBytes, workbookFileName, type WorkbookInput } from '../excel/workbook.ts';
import { guestLink } from '../session/sessionFormat.ts';
import { computeCalc, resolveParams, sanitizeInputs, type SessionInputs } from '../session/guestView.ts';
import type { DeliverySummary } from './ctaPolicy.ts';

export type { DeliverySummary } from './ctaPolicy.ts';
export { ctaStateOf as ctaStateFrom } from '../session/guestView.ts';

// ---------------------------------------------------------------------------
// Wynik do zamrożenia (ładunek RPC prepare_calculation_delivery)
// ---------------------------------------------------------------------------
export interface CalcPayload {
  result: CalcResult;
  /** Wariant miksu wybrany suwakiem w momencie CTA (brak wyboru = maksimum KH). */
  mix: MixResult;
  calc_version: string;
}

/** Liczy wynik i miks z żywej sesji; null, gdy dane są niekompletne lub niepoprawne. */
export function buildCalcPayload(row: { inputs: unknown; params: unknown; mix_kh: number | null }): CalcPayload | null {
  const calc = computeCalc(sanitizeInputs(row.inputs), resolveParams(row.params));
  if (!calc) return null;
  return {
    result: calc.result,
    mix: mix(calc.result, row.mix_kh ?? calc.result.maksNowychKh, calc.wspCzasu),
    calc_version: calc.result.calcVersion,
  };
}

// ---------------------------------------------------------------------------
// Snapshot z bazy
// ---------------------------------------------------------------------------
export interface SnapshotRow {
  inputs: unknown;
  params: unknown;
  result: unknown;
  mix: unknown;
  calc_version: string;
  created_at: string;
}

export interface ParsedSnapshot {
  inputs: SessionInputs;
  params: CalcParams;
  result: CalcResult;
  mix: MixResult;
  calcVersion: string;
  createdAt: Date;
}

/** Zamrożony stan jest uszkodzony lub w nieoczekiwanym kształcie — nie wysyłamy czegoś, czego nie rozumiemy. */
export class SnapshotError extends Error {}

const RESULT_NUMBER_KEYS = [
  'kosztMies',
  'efektywneGodziny',
  'kosztGodziny',
  'godzinyDoOdzyskania',
  'udzialCzasu',
  'minutyKhMies',
  'minutyKpirMies',
  'minutyKhDzien',
  'odzyskanyCzasWKlientachKpir',
  'maksNowychKh',
  'maksNowychKpir',
] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumberOrNull = (v: unknown): v is number | null => v === null || isNumber(v);

export function parseSnapshot(row: SnapshotRow): ParsedSnapshot {
  const result = row.result;
  if (!isRecord(result) || !RESULT_NUMBER_KEYS.every((k) => isNumber(result[k]))) {
    throw new SnapshotError('Snapshot: niepoprawny wynik');
  }
  for (const k of ['cenaKh', 'cenaKpir', 'przychodNaGodzine'] as const) {
    // starsze snapshoty mogą nie mieć pola; brak traktujemy jak null
    if (result[k] !== undefined && !isNumberOrNull(result[k])) throw new SnapshotError('Snapshot: niepoprawny wynik');
  }

  const m = row.mix;
  if (!isRecord(m) || !isNumber(m.kh) || !isNumber(m.kpir) || !isNumberOrNull(m.przychodMies) || !isNumber(m.wykorzystanieCzasu)) {
    throw new SnapshotError('Snapshot: niepoprawny miks');
  }

  const createdAt = new Date(row.created_at);
  if (Number.isNaN(createdAt.getTime())) throw new SnapshotError('Snapshot: niepoprawna data');
  if (typeof row.calc_version !== 'string' || row.calc_version === '') throw new SnapshotError('Snapshot: brak wersji logiki');

  return {
    inputs: sanitizeInputs(row.inputs),
    params: resolveParams(row.params),
    result: {
      ...(result as unknown as CalcResult),
      cenaKh: (result.cenaKh as number | null | undefined) ?? null,
      cenaKpir: (result.cenaKpir as number | null | undefined) ?? null,
      przychodNaGodzine: (result.przychodNaGodzine as number | null | undefined) ?? null,
    },
    mix: m as unknown as MixResult,
    calcVersion: row.calc_version,
    createdAt,
  };
}

// ---------------------------------------------------------------------------
// Wiadomość: Excel + mail ze snapshotu
// ---------------------------------------------------------------------------
export interface OrgInfo {
  name: string;
  brand: unknown;
}
export interface CompanyInfo {
  name: string | null;
  nip: string;
}
export interface ConsultantInfo {
  name: string | null;
  phone: string | null;
  signature: string | null;
  /** Adres, na który trafią odpowiedzi rozmówcy (Reply-To); null = bez Reply-To. */
  email: string | null;
}

export function toWorkbookInput(snapshot: ParsedSnapshot, org: OrgInfo, company: CompanyInfo, consultant: ConsultantInfo): WorkbookInput {
  return {
    organizationName: org.name,
    accentColor: parseBrand(org.brand).primaryColor ?? null,
    company: { name: company.name, nip: company.nip },
    consultantName: consultant.name,
    createdAt: snapshot.createdAt,
    inputs: snapshot.inputs,
    params: snapshot.params,
    result: snapshot.result,
    mix: snapshot.mix,
    calcVersion: snapshot.calcVersion,
  };
}

export function toEmailInput(
  snapshot: ParsedSnapshot,
  org: OrgInfo,
  company: CompanyInfo,
  consultant: ConsultantInfo,
  sessionUrl: string,
  options: { landingInvitation?: boolean } = {},
): EmailInput {
  return {
    organizationName: org.name,
    brand: parseBrand(org.brand),
    consultant: { name: consultant.name, phone: consultant.phone, signature: consultant.signature },
    company: { name: company.name, nip: company.nip },
    summary: { godzinyDoOdzyskania: snapshot.result.godzinyDoOdzyskania, maksNowychKh: snapshot.result.maksNowychKh },
    sessionUrl,
    landingInvitation: options.landingInvitation === true,
  };
}

export interface DeliveryContext {
  snapshot: SnapshotRow;
  org: OrgInfo;
  company: CompanyInfo;
  consultant: ConsultantInfo;
  /** Token sesji rozmówcy (do linku). */
  token: string;
  /** Adres aplikacji, np. https://atai.mitax.pl (APP_BASE_URL). */
  appBaseUrl: string;
  /** Adres rozmówcy, już zwalidowany (parseEmail). */
  recipient: string;
  defaultSender: MailAddress;
  /** Zaproszenie na landing page w mailu (flaga MAIL_LANDING_INVITATION); brak = wyłączone. */
  landingInvitation?: boolean;
}

/** Składa gotową do wysłania wiadomość: mail w marce organizacji z Excelem zbudowanym ze snapshotu. */
export async function buildDeliveryMessage(ctx: DeliveryContext): Promise<MailMessage> {
  const snapshot = parseSnapshot(ctx.snapshot);
  const workbook = toWorkbookInput(snapshot, ctx.org, ctx.company, ctx.consultant);
  const bytes = await buildWorkbookBytes(workbook);

  const rendered = renderCalculationEmail(toEmailInput(snapshot, ctx.org, ctx.company, ctx.consultant, guestLink(ctx.appBaseUrl, ctx.token), {
      landingInvitation: ctx.landingInvitation,
    }));

  return buildCalculationMessage({
    rendered,
    brand: parseBrand(ctx.org.brand),
    organizationName: ctx.org.name,
    defaultSender: ctx.defaultSender,
    recipient: ctx.recipient,
    replyTo: ctx.consultant.email ? { email: ctx.consultant.email, name: ctx.consultant.name } : null,
    attachment: {
      filename: workbookFileName(snapshot.createdAt),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: bytes,
    },
  });
}

// ---------------------------------------------------------------------------
// Stan dostaw → stan CTA
// ---------------------------------------------------------------------------
export type { LeadRow, DeliveryRow } from './deliverySummary.ts';
export { summarizeDeliveries, isDuplicateSend, DUPLICATE_WINDOW_MS } from './deliverySummary.ts';
