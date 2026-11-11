/**
 * Widok sesji dla rozmówcy (bez logowania) — czysta logika współdzielona przez aplikację (Vite)
 * i Edge Function `guest-session` (Deno). Dlatego importy mają rozszerzenie .ts.
 *
 * Wszystkie obliczenia robi src/calc (reguła 1). Ten moduł tylko:
 *  - przepuszcza dane rozmówcy przez listę dozwolonych pól (sanitizeInputs),
 *  - tłumaczy je na wejście kalkulatora (toCalcInputs),
 *  - składa to, co rozmówca ma zobaczyć, i niczego więcej (buildGuestView).
 */
import {
  allMixes,
  calculate,
  CalcInputError,
  DEFAULT_INPUTS,
  DEFAULT_PARAMS,
  type CalcInputs,
  type CalcParams,
  type CalcResult,
  type MixResult,
} from '../calc/calculator.ts';
import { toCompanyView, type CompanyRow, type CompanyView } from '../company/companyView.ts';
import { buildCtaView, type CtaState, type CtaView, type DeliverySummary } from '../cta/ctaPolicy.ts';

/** Pola, które wpisuje rozmówca (kształt UI, jak w prototypie; efektywność w %). */
export const GUEST_INPUT_KEYS = ['kh', 'kpir', 'prac', 'przychod', 'koszty', 'ef', 'wspCzas', 'wspCena'] as const;
export type GuestInputKey = (typeof GUEST_INPUT_KEYS)[number];

/** Wartość pola: liczba albo '' (pole wyczyszczone). */
export type InputValue = number | '';
export type SessionInputs = Partial<Record<GuestInputKey, InputValue>>;

/** Górne ograniczenie wartości z formularza — chroni przed absurdalnymi liczbami. */
const MAX_INPUT_VALUE = 1e12;
/** Tyle wariantów miksu maksymalnie wysyłamy rozmówcy (ochrona rozmiaru odpowiedzi). */
const MAX_MIX_VARIANTS = 1000;

/** Zostawia tylko dozwolone pola z liczbami (lub ''), resztę odrzuca. Lustro filtra SQL private.filter_inputs. */
export function sanitizeInputs(raw: unknown): SessionInputs {
  const out: SessionInputs = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  for (const key of GUEST_INPUT_KEYS) {
    if (!Object.hasOwn(obj, key)) continue; // tylko własne pola, bez dziedziczonych po prototypie
    const v = obj[key];
    if (v === '') out[key] = '';
    else if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_INPUT_VALUE) out[key] = v;
  }
  return out;
}

const PARAM_KEYS = ['celKorzysci', 'dniRobocze', 'godzinyDziennie'] as const;

/** Ciche założenia sesji: wartości wbudowane nadpisane dodatnimi liczbami z sesji (kopia z organizacji). */
export function resolveParams(raw: unknown): CalcParams {
  const out: CalcParams = { ...DEFAULT_PARAMS };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  for (const key of PARAM_KEYS) {
    if (!Object.hasOwn(obj, key)) continue;
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[key] = v;
  }
  return out;
}

const asNumber = (v: InputValue | undefined): number | null => (typeof v === 'number' ? v : null);

/**
 * Dane z formularza → wejście kalkulatora, albo null, gdy brakuje wymaganych pól.
 * Jak w prototypie: wymagane są liczby klientów (obie, może być 0), pracownicy i koszty wynagrodzeń;
 * przychód jest opcjonalny; puste lub zerowe założenia opcjonalne zastępują wartości domyślne.
 */
export function toCalcInputs(inputs: SessionInputs): CalcInputs | null {
  const kh = asNumber(inputs.kh);
  const kpir = asNumber(inputs.kpir);
  const prac = asNumber(inputs.prac);
  const koszty = asNumber(inputs.koszty);
  if (kh === null || kpir === null || prac === null || koszty === null) return null;

  const przychod = asNumber(inputs.przychod);
  const ef = asNumber(inputs.ef);
  const wspCzasu = asNumber(inputs.wspCzas);
  const wspCeny = asNumber(inputs.wspCena);

  return {
    kh,
    kpir,
    pracownicy: prac,
    kosztyWynagrodzenRok: koszty,
    przychodRok: przychod !== null && przychod > 0 ? przychod : null,
    efektywnosc: ef ? ef / 100 : undefined,
    wspCzasu: wspCzasu || undefined,
    wspCeny: wspCeny || undefined,
  };
}

export interface ComputedCalc {
  result: CalcResult;
  /** Współczynnik czasu KH/KPiR użyty w obliczeniach (potrzebny do miksu). */
  wspCzasu: number;
}

/** Liczy wynik z danych sesji; null, gdy dane są niekompletne lub niepoprawne (np. ujemne, efektywność > 100%). */
export function computeCalc(inputs: SessionInputs, params: CalcParams): ComputedCalc | null {
  const calcInputs = toCalcInputs(inputs);
  if (!calcInputs) return null;
  try {
    const result = calculate(calcInputs, params);
    return { result, wspCzasu: calcInputs.wspCzasu ?? DEFAULT_INPUTS.wspCzasu };
  } catch (e) {
    if (e instanceof CalcInputError) return null;
    throw e;
  }
}

/**
 * To, co rozmówca widzi po odsłonięciu wyniku. Nie ma tu kosztu zatrudnienia, efektywnych godzin
 * ani kosztu godziny; ciche założenia (params) nie są przekazywane wprost. Wartość czasu to
 * cel korzyści, który prototyp pokazuje rozmówcy, gdy nie podał przychodu.
 */
export interface GuestResult {
  calcVersion: string;
  godzinyDoOdzyskania: number;
  minutyKhMies: number;
  minutyKpirMies: number;
  minutyKhDzien: number;
  maksNowychKh: number;
  maksNowychKpir: number;
  /** Czy znamy ceny (rozmówca podał przychód) — wtedy miks ma przychód, inaczej pokazujemy wartość czasu. */
  hasPrice: boolean;
  wartoscCzasuMies: number;
  /** Warianty miksu od maksimum KH do zera (src/calc allMixes) — suwak wybiera wiersz po `kh`. */
  mixes: MixResult[];
}

function allFinite(values: number[]): boolean {
  return values.every((v) => Number.isFinite(v));
}

export function buildGuestResult(inputs: SessionInputs, params: CalcParams): GuestResult | null {
  const computed = computeCalc(inputs, params);
  if (!computed) return null;
  const { result, wspCzasu } = computed;

  const numbers = [
    result.godzinyDoOdzyskania,
    result.minutyKhMies,
    result.minutyKpirMies,
    result.minutyKhDzien,
    result.maksNowychKh,
    result.maksNowychKpir,
  ];
  if (!allFinite(numbers) || result.maksNowychKh > MAX_MIX_VARIANTS) return null;

  return {
    calcVersion: result.calcVersion,
    godzinyDoOdzyskania: result.godzinyDoOdzyskania,
    minutyKhMies: result.minutyKhMies,
    minutyKpirMies: result.minutyKpirMies,
    minutyKhDzien: result.minutyKhDzien,
    maksNowychKh: result.maksNowychKh,
    maksNowychKpir: result.maksNowychKpir,
    hasPrice: result.cenaKh !== null,
    wartoscCzasuMies: params.celKorzysci,
    mixes: allMixes(result, wspCzasu),
  };
}

/** Wiersz calc_sessions — tylko kolumny potrzebne do widoku rozmówcy. */
export interface SessionRow {
  inputs: unknown;
  params: unknown;
  revealed: boolean;
  mix_kh: number | null;
  reply: string;
  /** Firma przypięta do sesji (z GUS lub sam NIP); brak = rozmówca jeszcze nie podał NIP-u. */
  company?: CompanyRow | null;
  /** Stan dostaw (leady i wysyłki); brak = nic jeszcze nie wysłano. */
  delivery?: DeliverySummary | null;
}

const NO_DELIVERY: DeliverySummary = { hasLead: false, sentCount: 0, lockedEmail: null, lastSentAt: null };

/** Stan CTA z sesji i dostaw (wspólny dla widoku rozmówcy i funkcji wysyłki). */
export function ctaStateOf(args: {
  revealed: boolean;
  inputs: unknown;
  params: unknown;
  hasCompany: boolean;
  delivery: DeliverySummary;
}): CtaState {
  return {
    revealed: args.revealed,
    hasCompany: args.hasCompany,
    dataComplete: computeCalc(sanitizeInputs(args.inputs), resolveParams(args.params)) !== null,
    sentCount: args.delivery.sentCount,
    lockedEmail: args.delivery.lockedEmail,
  };
}

export interface GuestView {
  inputs: SessionInputs;
  revealed: boolean;
  /** Wybrany przez suwak miks (liczba nowych klientów KH); null = maksimum. */
  mixKh: number | null;
  reply: string;
  /** Wynik tylko po odsłonięciu przez konsultanta i tylko przy poprawnych danych. */
  result: GuestResult | null;
  /** Firma rozmówcy w postaci bezpiecznej do pokazania (nazwa, adres, NIP); null = jeszcze brak NIP-u. */
  company: CompanyView | null;
  /** NIP jest zablokowany (utworzono leada) — nie można go już zmienić. */
  nipLocked: boolean;
  /** Stan CTA „Przyślij mi kalkulację”: czy można wysłać, ile razy wysłano, zamaskowany adres. */
  cta: CtaView;
}

export function buildGuestView(row: SessionRow): GuestView {
  const inputs = sanitizeInputs(row.inputs);
  return {
    inputs,
    revealed: row.revealed,
    mixKh: row.mix_kh,
    reply: row.reply,
    result: row.revealed ? buildGuestResult(inputs, resolveParams(row.params)) : null,
    company: row.company ? toCompanyView(row.company) : null,
    nipLocked: (row.delivery ?? NO_DELIVERY).hasLead,
    cta: buildCtaView(
      ctaStateOf({
        revealed: row.revealed,
        inputs,
        params: row.params,
        hasCompany: Boolean(row.company),
        delivery: row.delivery ?? NO_DELIVERY,
      }),
    ),
  };
}

/**
 * Wariant miksu do pokazania dla wybranej przez suwak liczby nowych klientów KH.
 * Brak wyboru (null) = maksimum; wartości spoza zakresu są przycinane do [0, maksimum].
 */
export function pickMix(result: GuestResult, mixKh: number | null): MixResult {
  const max = result.maksNowychKh;
  const wanted = mixKh === null ? max : Math.max(0, Math.min(Math.floor(mixKh), max));
  const found = result.mixes.find((m) => m.kh === wanted);
  // mixes zawsze zawiera wszystkie wartości od max do 0; ostatnia deska ratunku to pierwszy wariant.
  return found ?? (result.mixes[0] as MixResult);
}
