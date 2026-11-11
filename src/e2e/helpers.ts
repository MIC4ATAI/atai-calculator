/**
 * Pomocnicze funkcje testów end-to-end: wywołania Edge Functions, dostęp administracyjny do bazy (service role,
 * wyłącznie w testach lokalnych) i odczyt wiadomości z Mailpita.
 *
 * Konfigurację (adresy, klucze) dostarcza scripts/e2e.mjs przez zmienne środowiskowe E2E_*.
 */
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak ${name}. Uruchamiaj testy przez „npm run test:e2e” (skrypt dostarcza konfigurację).`);
  return value;
}

export const API_URL = need('E2E_API_URL');
const PUBLISHABLE_KEY = need('E2E_PUBLISHABLE_KEY');
const MAILPIT_URL = need('E2E_MAILPIT_URL');

/** Dostęp administracyjny do lokalnej bazy: tworzenie sesji i odczyt stanu, którego rozmówca nie widzi. */
export const admin = createClient(API_URL, need('E2E_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

/** Dane z supabase/seed.sql: organizacja MITAX i konsultantka Ola. */
export const MITAX_ORG = '10000000-0000-4000-8000-000000000001';
export const OLA = '00000000-0000-4000-8000-000000000003';
/** Marek: właściciel MITAX; w seedzie nie ma adresata powiadomień (test „brak adresata”). */
export const MAREK = '00000000-0000-4000-8000-000000000002';

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Krótki losowy sufiks, żeby przebiegi testów nie kolidowały ze sobą (dane w bazie są tylko do dopisywania). */
export const unique = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------
// Edge Functions
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FnResult = { status: number; body: any };

/** Wywołanie funkcji tak jak z przeglądarki rozmówcy: tylko klucz publiczny, bez logowania. */
export async function callFn(name: string, body: unknown): Promise<FnResult> {
  const res = await fetch(`${API_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* odpowiedź bez JSON-a */
  }
  return { status: res.status, body: parsed };
}

/** Wywołanie funkcji z dowolnymi nagłówkami (np. zaplanowane zadanie bazy z sekretem, bez klucza publicznego). */
export async function callFnRaw(name: string, headers: Record<string, string>, method = 'POST'): Promise<FnResult> {
  const res = await fetch(`${API_URL}/functions/v1/${name}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'POST' ? '{}' : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* odpowiedź bez JSON-a */
  }
  return { status: res.status, body: parsed };
}

// ---------------------------------------------------------------------------
// Sesje
// ---------------------------------------------------------------------------
export interface TestSession {
  id: string;
  token: string;
}

/** Nowa sesja konsultantki Oli w MITAX (jak po „Nowa sesja”, ale bez logowania). */
export async function newSession(label: string, consultantId: string = OLA): Promise<TestSession> {
  const token = `e2e-${label}-${unique()}${unique()}`;
  const { data, error } = await admin
    .from('calc_sessions')
    .insert({ org_id: MITAX_ORG, consultant_id: consultantId, token })
    .select('id, token')
    .single();
  if (error) {
    throw new Error(`Nie można utworzyć sesji testowej (${error.message}). Czy baza ma seed? Uruchom: supabase db reset`);
  }
  return data;
}

/** Przykład kontrolny wpisany przez rozmówcę (przez funkcję, jak z przeglądarki). */
export async function fillExample(token: string): Promise<void> {
  const r = await callFn('guest-session', {
    action: 'patch',
    token,
    patch: { kh: 100, kpir: 200, prac: 9, przychod: 2_000_000, koszty: 1_200_000 },
  });
  if (r.status !== 200) throw new Error(`Nie udało się wypełnić sesji: HTTP ${r.status}`);
}

/** Konsultant odsłania wynik (opcjonalnie z miksem wybranym suwakiem). */
export async function reveal(id: string, mixKh: number | null = null): Promise<void> {
  const { error } = await admin.from('calc_sessions').update({ revealed: true, mix_kh: mixKh }).eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Mailpit
// ---------------------------------------------------------------------------
interface MailpitMessage {
  ID: string;
  Subject: string;
  From: { Name: string; Address: string };
  To: { Address: string }[];
  ReplyTo?: { Name?: string; Address: string }[];
  Text: string;
  HTML: string;
  Attachments: { FileName: string; ContentType: string; Size: number; PartID: string }[];
}

export async function mailsTo(address: string): Promise<{ ID: string }[]> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}&limit=50`);
  const data = (await res.json()) as { messages: { ID: string }[] };
  return data.messages;
}

export async function mailCount(address: string): Promise<number> {
  return (await mailsTo(address)).length;
}

/** Najnowsza wiadomość do adresu (Mailpit zwraca od najnowszej). */
export async function latestMail(address: string): Promise<MailpitMessage> {
  const [first] = await mailsTo(address);
  if (!first) throw new Error(`Brak wiadomości do ${address} w Mailpicie`);
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${first.ID}`);
  return (await res.json()) as MailpitMessage;
}

export async function attachmentBytes(mail: MailpitMessage): Promise<Uint8Array> {
  const part = mail.Attachments[0];
  if (!part) throw new Error('Wiadomość nie ma załącznika');
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${mail.ID}/part/${part.PartID}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Sprzątanie skrzynki po testach: usuwa wiadomości do podanych adresów. */
export async function deleteMailsTo(addresses: string[]): Promise<void> {
  const ids: string[] = [];
  for (const address of addresses) ids.push(...(await mailsTo(address)).map((m) => m.ID));
  if (ids.length === 0) return;
  await fetch(`${MAILPIT_URL}/api/v1/messages`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ IDs: ids }),
  });
}

// ---------------------------------------------------------------------------
// Załącznik Excel
// ---------------------------------------------------------------------------
export interface WorkbookSummary {
  sheets: string[];
  /** „Klienci – pełna księgowość (KH)” z zakładki z rozmowy. */
  kh: unknown;
  godziny: number;
  /** „Nowi klienci KH” (miks z rozmowy). */
  mixKh: unknown;
  /** Wiersz z firmą w nagłówku zakładki. */
  firma: unknown;
  /** Zakładka „Twoja symulacja”: liczba komórek z formułą i ilu z nich zapisano wartość buforowaną (podglądy bez przeliczania). */
  formulas: { total: number; withCachedResult: number };
}

/** Otwiera załącznik tak jak Excel i zwraca kluczowe wartości z zakładki „Kalkulacja z rozmowy”. */
export async function readWorkbook(bytes: Uint8Array): Promise<WorkbookSummary> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as never);
  const first = wb.worksheets[0]!;
  const byLabel = (label: string): ExcelJS.CellValue => {
    let found: ExcelJS.CellValue = null;
    first.eachRow((row) => {
      if (row.getCell(1).value === label) found = row.getCell(2).value;
    });
    return found;
  };
  let total = 0;
  let withCachedResult = 0;
  wb.worksheets[1]?.eachRow((row) =>
    row.eachCell((cell) => {
      const v = cell.value as { formula?: string; result?: unknown } | null;
      if (v && typeof v === 'object' && typeof v.formula === 'string') {
        total += 1;
        if (v.result !== undefined && v.result !== null) withCachedResult += 1;
      }
    }),
  );
  return {
    formulas: { total, withCachedResult },
    sheets: wb.worksheets.map((w) => w.name),
    kh: byLabel('Klienci – pełna księgowość (KH)'),
    godziny: Number(byLabel('Godziny do odzyskania / mies.')),
    mixKh: byLabel('Nowi klienci KH'),
    firma: first.getCell('A3').value,
  };
}

// ---------------------------------------------------------------------------
// NIP-y z poprawną sumą kontrolną (do testów pamięci podręcznej i limitów)
// ---------------------------------------------------------------------------
const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

/** `count` losowych, poprawnych NIP-ów (suma kontrolna), niekolidujących z poprzednimi przebiegami. */
export function randomValidNips(count: number): string[] {
  const nips: string[] = [];
  while (nips.length < count) {
    const base = String(Math.floor(100_000_000 + Math.random() * 899_999_999));
    const sum = [...base].reduce((acc, d, i) => acc + Number(d) * NIP_WEIGHTS[i]!, 0) % 11;
    if (sum !== 10) nips.push(`${base}${sum}`);
  }
  return nips;
}
