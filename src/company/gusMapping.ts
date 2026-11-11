/**
 * Odpowiedź GUS (BIR1, biblioteka bir1 zwraca ją jako obiekt z tekstowymi polami) → dane firmy.
 * Czysta logika współdzielona z Edge Function `lookup-company` (Deno), stąd importy z rozszerzeniem .ts.
 *
 * Odpowiedzi GUS traktujemy jak dane niezaufane: przycinamy białe znaki i długości (zgodnie z ograniczeniami
 * tabeli `companies`), sprawdzamy NIP i kształt, a wszystko, co się nie zgadza, uznajemy za „brak danych”.
 */
import { normalizeNip } from '../calc/nip.ts';

export type GusType = 'P' | 'F' | 'LP' | 'LF';

export interface CompanyData {
  nip: string;
  regon: string | null;
  name: string;
  street: string | null;
  buildingNo: string | null;
  unitNo: string | null;
  postalCode: string | null;
  city: string | null;
  voivodeship: string | null;
  /** P osoba prawna, F osoba fizyczna (jednoosobowa działalność), LP/LF jednostki lokalne. */
  gusType: GusType | null;
}

/** Limity zgodne z ograniczeniami CHECK w tabeli `companies`. */
const MAX = { name: 500, regon: 20, street: 200, buildingNo: 50, unitNo: 50, postalCode: 20, city: 200, voivodeship: 100 };
/** Rozmiar surowej odpowiedzi zapisywanej w `gus_raw` — dalej niż to nie zapisujemy. */
const MAX_RAW_BYTES = 8 * 1024;

const GUS_TYPES: readonly string[] = ['P', 'F', 'LP', 'LF'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Tekst bez nadmiarowych spacji, przycięty do limitu; pusty → null. */
function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? null : text.slice(0, max);
}

/** Jeśli GUS zwróci kilka rekordów, bierzemy podmiot główny (P lub F), a w ostateczności pierwszy. */
function pickRecord(raw: unknown): Record<string, unknown> | null {
  if (Array.isArray(raw)) {
    const records = raw.filter(isRecord);
    return records.find((r) => r.Typ === 'P' || r.Typ === 'F') ?? records[0] ?? null;
  }
  return isRecord(raw) ? raw : null;
}

/**
 * Mapuje rekord GUS na dane firmy albo zwraca null, gdy odpowiedź jest niepoprawna: brak nazwy,
 * NIP w odpowiedzi różny od szukanego (nie ufamy podmiotowi z innego NIP-u).
 */
export function mapGusRecord(raw: unknown, requestedNip: string): CompanyData | null {
  const record = pickRecord(raw);
  if (!record) return null;

  const returnedNip = typeof record.Nip === 'string' ? normalizeNip(record.Nip) : '';
  if (returnedNip !== '' && returnedNip !== requestedNip) return null;

  const name = clean(record.Nazwa, MAX.name);
  if (!name) return null;

  const regon = clean(record.Regon, MAX.regon);
  const typ = clean(record.Typ, 4);

  return {
    nip: requestedNip,
    regon: regon !== null && /^\d{9}(\d{5})?$/.test(regon) ? regon : null,
    name,
    street: clean(record.Ulica, MAX.street),
    buildingNo: clean(record.NrNieruchomosci, MAX.buildingNo),
    unitNo: clean(record.NrLokalu, MAX.unitNo),
    postalCode: clean(record.KodPocztowy, MAX.postalCode),
    city: clean(record.Miejscowosc, MAX.city),
    voivodeship: clean(record.Wojewodztwo, MAX.voivodeship),
    gusType: typ !== null && GUS_TYPES.includes(typ) ? (typ as GusType) : null,
  };
}

/** Ładunek dla RPC `attach_company_to_session` z danymi z GUS. */
export function toAttachPayload(company: CompanyData, rawRecord: unknown): Record<string, unknown> {
  const rawJson = JSON.stringify(rawRecord ?? null);
  return {
    nip: company.nip,
    regon: company.regon,
    name: company.name,
    street: company.street,
    building_no: company.buildingNo,
    unit_no: company.unitNo,
    postal_code: company.postalCode,
    city: company.city,
    voivodeship: company.voivodeship,
    gus_type: company.gusType,
    gus_status: 'found',
    gus_raw: rawJson.length <= MAX_RAW_BYTES ? rawRecord : null,
  };
}

/**
 * Ładunek „bez nowych danych”: sam NIP i status `unavailable`. RPC zakłada wtedy firmę z samym NIP-em,
 * a jeśli firma już istnieje, tylko ją przypina i niczego nie nadpisuje. Używamy go, gdy GUS jest
 * niedostępny albo gdy dane mamy w pamięci podręcznej.
 */
export function unavailablePayload(nip: string): Record<string, unknown> {
  return { nip, gus_status: 'unavailable' };
}
