/**
 * Klauzula informacyjna RODO (art. 13) przy CTA „Przyślij mi kalkulację”. Treść i link do polityki prywatności pochodzą
 * z organizacji (kolumny `organizations.cta_notice` i `organizations.privacy_policy_url`), bo to organizacja jest
 * administratorem danych leadów. To NIE jest zgoda: kalkulator nie zbiera zgód marketingowych (te zbiera landing page
 * organizacji), więc przy polu e-mail nie ma żadnego pola do zaznaczenia.
 *
 * Czysta logika współdzielona z Edge Function `guest-session` (importy z .ts). Treść niezaufana (pochodzi z bazy,
 * edytuje ją właściciel organizacji) jest czyszczona i zwracana jako zwykły tekst — React escapuje ją przy wyświetlaniu.
 */
import { parseHttpsUrl, parseDisplayName } from '../email/brand.ts';

/**
 * BRZMIENIE DO POTWIERDZENIA Z PRAWNIKIEM (jak LANDING_INVITATION_TEXT i ONE_TIME_NOTICE_TEXT). Domyślna treść, gdy organizacja
 * nie ma własnej. Do uzupełnienia przez prawnika: okres przechowywania, odbiorcy danych (dostawca poczty, operator
 * platformy jako podmiot przetwarzający), dane kontaktowe administratora i podstawa prawna.
 * `{organization}` zastępujemy nazwą organizacji.
 */
export const DEFAULT_CTA_NOTICE = [
  'Administratorem Twoich danych osobowych jest {organization}.',
  'Adres e-mail i dane z rozmowy wykorzystamy wyłącznie po to, aby przesłać Ci kalkulację oraz link do sesji, o które prosisz, i obsłużyć tę prośbę (art. 6 ust. 1 lit. b i f RODO). Podanie adresu jest dobrowolne, ale bez niego nie możemy wysłać kalkulacji.',
  'Masz prawo dostępu do swoich danych, ich sprostowania, usunięcia, ograniczenia przetwarzania i sprzeciwu oraz prawo wniesienia skargi do Prezesa UODO. Nie zbieramy tu żadnych zgód marketingowych.',
].join('\n\n');

/** Limity chroniące widok klienta przed absurdalnie długą treścią z bazy. */
export const MAX_NOTICE_LENGTH = 1500;
export const MAX_NOTICE_PARAGRAPHS = 8;
const FALLBACK_ORGANIZATION = 'organizacja prowadząca rozmowę';

export interface CtaNoticeSource {
  name: string | null | undefined;
  privacy_policy_url: string | null | undefined;
  cta_notice: string | null | undefined;
}

/** To, co widzi rozmówca przy polu e-mail. */
export interface CtaNoticeView {
  organization: string;
  /** Akapity zwykłego tekstu (bez HTML). */
  paragraphs: string[];
  /** Link do polityki prywatności organizacji (https) albo null, gdy organizacja go nie ustawiła. */
  privacyUrl: string | null;
}

/** Usuwa znaki sterujące (oprócz nowej linii), ujednolica końce linii i ogranicza długość. */
function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029]/g, ' ')
    .slice(0, MAX_NOTICE_LENGTH * 2);
}

export function buildCtaNotice(source: CtaNoticeSource): CtaNoticeView {
  const organization = parseDisplayName(source.name) ?? FALLBACK_ORGANIZATION;
  const custom = typeof source.cta_notice === 'string' ? cleanText(source.cta_notice).trim() : '';
  const template = custom !== '' ? custom : DEFAULT_CTA_NOTICE;

  const paragraphs = template
    .replaceAll('{organization}', organization)
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim())
    // Nazwa kończąca się kropką („sp. z o.o.”) + kropka szablonu dawałaby „o.o..”; wielokropek („...”) zostaje.
    .map((p) => p.replace(/([^.])\.\.$/, '$1.'))
    .filter((p) => p !== '')
    .slice(0, MAX_NOTICE_PARAGRAPHS);

  let total = 0;
  const limited: string[] = [];
  for (const p of paragraphs) {
    if (total + p.length > MAX_NOTICE_LENGTH) {
      const rest = MAX_NOTICE_LENGTH - total;
      if (rest > 20) limited.push(`${p.slice(0, rest - 1).trimEnd()}…`);
      break;
    }
    limited.push(p);
    total += p.length;
  }

  return { organization, paragraphs: limited, privacyUrl: parseHttpsUrl(source.privacy_policy_url) };
}
