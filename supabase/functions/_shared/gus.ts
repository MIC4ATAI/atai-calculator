// Klient GUS (BIR1 / REGON) przez bibliotekę bir1. Bez klucza biblioteka używa publicznej bazy TESTOWEJ
// (stare, zanonimizowane dane); klucz produkcyjny (wniosek na regon_bir@stat.gov.pl) przełącza na produkcję.
import Bir from 'npm:bir1@4.2.0';

export type GusResult =
  | { kind: 'found'; record: unknown }
  | { kind: 'not_found' } // GUS odpowiedział, że nie ma podmiotu o tym NIP-ie
  | { kind: 'unavailable' }; // awaria, timeout, zły klucz — rozmowa toczy się dalej z samym NIP-em

const TIMEOUT_MS = 8000;

/** „Nie znaleziono podmiotu” to ErrorCode "4" w odpowiedzi GUS — nie dopasowujemy tekstu komunikatu. */
function isNotFound(error: unknown): boolean {
  const response = (error as { response?: { ErrorCode?: unknown } } | null)?.response;
  return response?.ErrorCode === '4';
}

export async function lookupNip(nip: string, apiKey?: string): Promise<GusResult> {
  const bir = apiKey ? new Bir({ key: apiKey }) : new Bir();
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
  });

  try {
    const record = await Promise.race([bir.search({ nip }), timeout]);
    return { kind: 'found', record };
  } catch (e) {
    if (isNotFound(e)) return { kind: 'not_found' };
    // Tylko komunikat, bez żadnych danych z żądania.
    console.error('gus: zapytanie nieudane:', e instanceof Error ? e.message : 'nieznany błąd');
    return { kind: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}
