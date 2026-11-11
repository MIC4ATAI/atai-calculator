/**
 * Firma w widoku rozmówcy: tylko to, co potrzebne do potwierdzenia „Czy to Twoja firma?”.
 * Nigdy surowa odpowiedź GUS ani identyfikatory z bazy.
 */

/** Wiersz `companies` — tylko kolumny potrzebne do widoku i do polityki pamięci podręcznej. */
export interface CompanyRow {
  nip: string;
  regon: string | null;
  name: string | null;
  street: string | null;
  building_no: string | null;
  unit_no: string | null;
  postal_code: string | null;
  city: string | null;
  voivodeship: string | null;
  gus_type: string | null;
  gus_status: string;
  fetched_at: string;
}

export interface CompanyView {
  /** NIP w zapisie 526-104-05-67. */
  nip: string;
  /** null, gdy GUS był niedostępny i znamy tylko NIP. */
  name: string | null;
  address: string | null;
  gusStatus: 'found' | 'unavailable';
}

/** 5261040567 → 526-104-05-67 (inne wartości zwracamy bez zmian). */
export function formatNip(nip: string): string {
  return /^\d{10}$/.test(nip) ? `${nip.slice(0, 3)}-${nip.slice(3, 6)}-${nip.slice(6, 8)}-${nip.slice(8)}` : nip;
}

/**
 * Adres w jednej linii: „ul. Test-Krucza 12/3, 02-674 Warszawa”. Gdy nie ma ulicy (np. wieś),
 * numer stoi przy miejscowości: „Wola 15, 12-345”.
 */
export function formatAddress(row: Pick<CompanyRow, 'street' | 'building_no' | 'unit_no' | 'postal_code' | 'city'>): string | null {
  const house = [row.building_no, row.unit_no].filter(Boolean).join('/');
  const place = [row.postal_code, row.city].filter(Boolean).join(' ');

  let address: string;
  if (row.street) {
    address = [[row.street, house].filter(Boolean).join(' '), place].filter(Boolean).join(', ');
  } else if (house) {
    address = [[row.city, house].filter(Boolean).join(' '), row.postal_code].filter(Boolean).join(', ');
  } else {
    address = place;
  }
  return address === '' ? null : address;
}

export function toCompanyView(row: CompanyRow): CompanyView {
  return {
    nip: formatNip(row.nip),
    name: row.name,
    address: formatAddress(row),
    gusStatus: row.gus_status === 'found' ? 'found' : 'unavailable',
  };
}
