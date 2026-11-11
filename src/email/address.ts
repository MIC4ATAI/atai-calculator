/**
 * Adresy e-mail: walidacja, normalizacja i maskowanie. Czysta logika (Node i Deno).
 *
 * Walidacja jest celowo ostrzejsza niż ograniczenie w bazie (`leads.email`): odrzuca znaki, które umożliwiają
 * wstrzyknięcie dodatkowych odbiorców lub nagłówków (CR/LF, przecinek, średnik, nawiasy kątowe, cudzysłów),
 * więc to, co przejdzie, spełnia też regułę bazy.
 */

export const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;

/** Znaki niedozwolone w części lokalnej: białe znaki, separatory odbiorców, nawiasy, cudzysłów, ukośnik, sterujące. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_LOCAL = /[\s,;:<>()[\]"\\\u0000-\u001f\u007f]/u;
/** Domena: etykiety liter/cyfr/myślników (bez myślnika na brzegach), na końcu TLD z samych liter (min. 2). */
const DOMAIN = /^(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+\p{L}{2,}$/u;

/** Zwraca znormalizowany adres (małe litery, bez spacji z brzegów) albo null, gdy adres jest niepoprawny. */
export function parseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > MAX_EMAIL_LENGTH) return null;

  const parts = email.split('@');
  if (parts.length !== 2) return null;
  const [local, domain] = parts as [string, string];

  if (local.length < 1 || local.length > MAX_LOCAL_LENGTH) return null;
  if (FORBIDDEN_LOCAL.test(local)) return null;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  if (!DOMAIN.test(domain)) return null;

  return email;
}

export const isValidEmail = (raw: unknown): boolean => parseEmail(raw) !== null;

/** „jan.kowalski@firma.pl” → „j***@firma.pl” — rozmówca widzi, na jaki adres poszła kalkulacja, bez pełnego adresu. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
