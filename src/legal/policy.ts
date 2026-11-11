/**
 * Polityka prywatności administratora danych (organizacji) dla kalkulatora — PROJEKT DO WERYFIKACJI PRAWNEJ.
 *
 * Treść opisuje to, co aplikacja faktycznie robi z danymi (patrz docs/spec.md); nie wymyśla niczego ponad to. Czego kod nie
 * wie (adres siedziby, kontakt, okres przechowywania, sposób realizacji żądania usunięcia, szczegóły przekazywania poza EOG),
 * zostaje oznaczone widocznym znacznikiem „[do uzupełnienia: …]”, a strona pokazuje ostrzeżenie „projekt”, dopóki cokolwiek
 * brakuje albo prawnik nie zatwierdził treści (`legalReviewedAt`). Dzięki temu nieskończony dokument nie wygląda na ostateczny.
 *
 * Podstawy prawne i cele są spójne z klauzulą informacyjną przy CTA (src/cta/notice.ts: art. 6 ust. 1 lit. b i f RODO).
 */

export interface PolicyConfig {
  controller: {
    name: string;
    /** NIP administratora (10 cyfr). */
    nip: string;
    address: string | null;
    contactEmail: string | null;
  };
  /** Okres przechowywania danych z rozmów i leadów (tekst zdania). */
  retention: string | null;
  /** Jak realizujemy żądanie usunięcia danych (historia sesji jest niemodyfikowalna z założenia). */
  erasureHandling: string | null;
  /** Szczegóły przekazywania danych poza EOG (dostawcy, mechanizm). */
  transfers: string | null;
  /** Data ostatniej aktualizacji treści (ISO, YYYY-MM-DD). */
  updatedAt: string;
  /** Data zatwierdzenia treści przez prawnika; null = projekt (strona pokazuje ostrzeżenie). */
  legalReviewedAt: string | null;
}

/** Konfiguracja dla MITAX Consulting sp. z o.o. Brakujące dane uzupełnia właściciel, a treść zatwierdza prawnik. */
export const MITAX_POLICY: PolicyConfig = {
  controller: {
    name: 'MITAX Consulting sp. z o.o.',
    nip: '6152043432',
    address: 'ul. Warszawska 4/8, 59-900 Zgorzelec',
    contactEmail: 'rodo@mitax.pl',
  },
  retention: null,
  erasureHandling: null,
  transfers: null,
  updatedAt: '2026-11-11',
  legalReviewedAt: null,
};

export interface PolicySection {
  id: string;
  heading: string;
  paragraphs: string[];
  /** Punkty (lista wypunktowana) po akapitach. */
  items?: string[];
}

export interface BuiltPolicy {
  title: string;
  updatedAt: string;
  sections: PolicySection[];
  /** Projekt: brakują dane albo treść nie została zatwierdzona prawnie. */
  isDraft: boolean;
  /** Czytelne nazwy brakujących danych (puste, gdy komplet). */
  missing: string[];
}

const ph = (label: string): string => `[do uzupełnienia: ${label}]`;

export function formatNip(nip: string): string {
  return /^[0-9]{10}$/.test(nip) ? `${nip.slice(0, 3)}-${nip.slice(3, 6)}-${nip.slice(6, 8)}-${nip.slice(8)}` : nip;
}

export function buildPrivacyPolicy(config: PolicyConfig): BuiltPolicy {
  const c = config.controller;
  const missing: string[] = [];
  const need = <T extends string | null>(value: T, label: string): string => {
    if (value === null || value.trim() === '') {
      missing.push(label);
      return ph(label);
    }
    return value.trim();
  };

  const address = need(c.address, 'adres siedziby administratora');
  const contact = need(c.contactEmail, 'adres e-mail do kontaktu w sprawach danych osobowych');
  const retention = need(config.retention, 'okres przechowywania danych');
  const erasure = need(config.erasureHandling, 'sposób realizacji żądania usunięcia danych');
  const transfers = need(config.transfers, 'szczegóły przekazywania danych poza EOG (dostawcy, mechanizm)');

  const sections: PolicySection[] = [
    {
      id: 'administrator',
      heading: '1. Administrator danych',
      paragraphs: [
        `Administratorem Twoich danych osobowych jest ${c.name}, NIP ${formatNip(c.nip)}, z siedzibą: ${address}.`,
        `W sprawach dotyczących danych osobowych możesz skontaktować się z nami pod adresem: ${contact}.`,
        'Niniejsza polityka dotyczy kalkulatora efektywności biura rachunkowego, z którego korzystasz podczas rozmowy z naszym konsultantem.',
      ],
    },
    {
      id: 'zakres',
      heading: '2. Jakie dane przetwarzamy, w jakim celu i na jakiej podstawie',
      paragraphs: ['Przetwarzamy dane w następującym zakresie:'],
      items: [
        'Dane firmy i rozmowy: numer NIP, dane firmy pobrane z rejestru REGON (nazwa, adres) oraz wartości, które wpisujesz do kalkulatora (m.in. liczba klientów i pracowników, przychód, koszty wynagrodzeń). Cel: przeprowadzenie kalkulacji podczas rozmowy z konsultantem i przygotowanie jej wyniku. Podstawa: art. 6 ust. 1 lit. f RODO (nasz prawnie uzasadniony interes: obsługa Twojego zapytania). Jeśli prowadzisz jednoosobową działalność gospodarczą, są to dane osobowe.',
        'Adres e-mail: podajesz go, gdy prosisz o przesłanie kalkulacji. Cel: wysłanie pliku Excel z kalkulacją i linku do Twojej sesji oraz obsługa tej prośby. Podstawa: art. 6 ust. 1 lit. b i f RODO (działania na Twoje żądanie, nasz prawnie uzasadniony interes).',
        'Stan rozmowy i historia zmian: po wysłaniu kalkulacji zapisujemy stan z rozmowy, zmiany, które wprowadzasz w sesji po otwarciu linku, oraz momenty powrotów do sesji; konsultant otrzymuje o tym krótkie powiadomienie. Cel: zachowanie ustaleń z rozmowy i przygotowanie do kontaktu z Tobą. Podstawa: art. 6 ust. 1 lit. f RODO.',
        'Dane techniczne: adres IP i dane przeglądarki przetwarzane w logach technicznych dostawców hostingu. Cel: zapewnienie bezpieczeństwa i prawidłowego działania aplikacji. Podstawa: art. 6 ust. 1 lit. f RODO.',
      ],
    },
    {
      id: 'zgody',
      heading: '3. Brak zgód marketingowych w kalkulatorze',
      paragraphs: [
        'Kalkulator nie zbiera zgód marketingowych i nie wysyła niczego poza tym, o co poprosisz (plik Excel i link do sesji). Ewentualny kontakt w celach marketingowych możliwy jest wyłącznie na podstawie odrębnej, dobrowolnej zgody, którą można wyrazić na osobnej stronie organizacji.',
      ],
    },
    {
      id: 'zrodlo',
      heading: '4. Źródło danych',
      paragraphs: [
        'Dane firmy (nazwę i adres) pobieramy z publicznego rejestru REGON (GUS) na podstawie podanego numeru NIP. Pozostałe dane podajesz Ty.',
      ],
    },
    {
      id: 'odbiorcy',
      heading: '5. Odbiorcy danych',
      paragraphs: [
        'Dane mogą być powierzane dostawcom usług, którzy przetwarzają je wyłącznie na nasze polecenie, na podstawie umów powierzenia:',
      ],
      items: [
        'dostawcy hostingu bazy danych i funkcji serwerowych (dane przechowywane są w regionie UE, we Frankfurcie),',
        'dostawcy hostingu aplikacji,',
        'dostawcy usługi wysyłki wiadomości e-mail,',
        'operator platformy, który udostępnia nam kalkulator jako usługę.',
      ],
    },
    {
      id: 'powiadomienia',
      heading: '6. Powiadomienia dla konsultantów',
      paragraphs: [
        'Powiadomienia dla konsultantów (np. o powrocie do sesji) nie zawierają danych Twojej firmy ani adresu e-mail: tylko informację o zdarzeniu i odnośnik, który otwiera się po zalogowaniu konsultanta.',
      ],
    },
    {
      id: 'eog',
      heading: '7. Przekazywanie danych poza Europejski Obszar Gospodarczy',
      paragraphs: [
        'Część dostawców może przetwarzać dane poza EOG. Wówczas stosujemy mechanizmy przewidziane w RODO, np. standardowe klauzule umowne.',
        transfers,
      ],
    },
    {
      id: 'okres',
      heading: '8. Jak długo przechowujemy dane',
      paragraphs: [
        retention,
        'Stan z rozmowy i historia zmian są zapisywane w sposób uniemożliwiający ich niezauważoną modyfikację, dlatego żądania usunięcia danych realizujemy w odrębnej, udokumentowanej procedurze.',
        erasure,
      ],
    },
    {
      id: 'cookies',
      heading: '9. Pliki cookies i pamięć przeglądarki',
      paragraphs: [
        'Aplikacja nie używa plików cookies, narzędzi analitycznych ani marketingowych. Rozmówca korzystający z linku do sesji nie ma zapisywanych niczego w pamięci przeglądarki. Dla zalogowanych konsultantów przeglądarka przechowuje dane sesji logowania i ostatnio wybraną organizację.',
      ],
    },
    {
      id: 'prawa',
      heading: '10. Twoje prawa',
      paragraphs: ['Przysługuje Ci prawo do:'],
      items: [
        'dostępu do swoich danych i uzyskania ich kopii,',
        'sprostowania danych,',
        'usunięcia danych,',
        'ograniczenia przetwarzania,',
        'przenoszenia danych,',
        'sprzeciwu wobec przetwarzania opartego na naszym prawnie uzasadnionym interesie,',
        'wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stawki 2, 00-193 Warszawa).',
      ],
    },
    {
      id: 'dobrowolnosc',
      heading: '11. Dobrowolność podania danych',
      paragraphs: [
        'Podanie danych jest dobrowolne. Bez numeru NIP i danych liczbowych nie przeprowadzimy kalkulacji, a bez adresu e-mail nie wyślemy jej wyniku.',
      ],
    },
    {
      id: 'decyzje',
      heading: '12. Zautomatyzowane podejmowanie decyzji',
      paragraphs: [
        'Kalkulator liczy wynik według ustalonych wzorów i ma charakter informacyjny. Nie podejmujemy wobec Ciebie decyzji w sposób zautomatyzowany i nie dokonujemy profilowania.',
      ],
    },
    {
      id: 'zmiany',
      heading: '13. Zmiany polityki',
      paragraphs: [`Ostatnia aktualizacja: ${config.updatedAt}. O istotnych zmianach poinformujemy na tej stronie.`],
    },
  ];

  const reviewed = config.legalReviewedAt !== null && config.legalReviewedAt.trim() !== '';
  return {
    title: `Polityka prywatności: ${c.name}`,
    updatedAt: config.updatedAt,
    sections,
    isDraft: !reviewed || missing.length > 0,
    missing,
  };
}

export interface TextSegment {
  text: string;
  /** Fragment „[do uzupełnienia: …]” do wyróżnienia na stronie. */
  placeholder: boolean;
}

/** Dzieli tekst na zwykłe fragmenty i znaczniki „[do uzupełnienia: …]” (do podświetlenia). */
export function splitPlaceholders(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  const re = /\[do uzupełnienia: [^\]]+\]/g;
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), placeholder: false });
    out.push({ text: m[0], placeholder: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), placeholder: false });
  return out;
}
