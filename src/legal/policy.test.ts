import { describe, expect, it } from 'vitest';
import { DEFAULT_CTA_NOTICE } from '../cta/notice';
import { buildPrivacyPolicy, formatNip, MITAX_POLICY, splitPlaceholders, type PolicyConfig } from './policy';

const COMPLETE: PolicyConfig = {
  controller: { name: 'MITAX Consulting sp. z o.o.', nip: '6152043432', address: 'ul. Przykładowa 1, 00-001 Warszawa', contactEmail: 'rodo@mitax.pl' },
  retention: 'Dane przechowujemy przez 3 lata od ostatniego kontaktu.',
  erasureHandling: 'Żądanie usunięcia rozpatrujemy w ciągu miesiąca.',
  transfers: 'Dostawca hostingu aplikacji przetwarza dane w USA na podstawie standardowych klauzul umownych.',
  updatedAt: '2026-11-11',
  legalReviewedAt: '2026-11-20',
};

const allText = (config: PolicyConfig): string =>
  buildPrivacyPolicy(config)
    .sections.flatMap((s) => [s.heading, ...s.paragraphs, ...(s.items ?? [])])
    .join('\n');

describe('buildPrivacyPolicy — projekt MITAX (dane jeszcze nieuzupełnione)', () => {
  const policy = buildPrivacyPolicy(MITAX_POLICY);

  it('jest oznaczona jako projekt i wymienia brakujące dane', () => {
    expect(policy.isDraft).toBe(true);
    expect(policy.missing).toEqual([
      'adres siedziby administratora',
      'adres e-mail do kontaktu w sprawach danych osobowych',
      'okres przechowywania danych',
      'sposób realizacji żądania usunięcia danych',
      'szczegóły przekazywania danych poza EOG (dostawcy, mechanizm)',
    ]);
  });

  it('nie wymyśla danych: każdy brak ma widoczny znacznik w tekście', () => {
    const text = allText(MITAX_POLICY);
    for (const label of policy.missing) expect(text).toContain(`[do uzupełnienia: ${label}]`);
  });

  it('wskazuje administratora z poprawnie sformatowanym NIP-em', () => {
    expect(policy.title).toBe('Polityka prywatności: MITAX Consulting sp. z o.o.');
    expect(allText(MITAX_POLICY)).toContain('NIP 615-204-34-32');
  });
});

describe('buildPrivacyPolicy — kompletna i zatwierdzona', () => {
  it('nie jest projektem i nie zawiera żadnego znacznika do uzupełnienia', () => {
    const policy = buildPrivacyPolicy(COMPLETE);
    expect(policy.isDraft).toBe(false);
    expect(policy.missing).toEqual([]);
    expect(allText(COMPLETE)).not.toContain('do uzupełnienia');
    expect(allText(COMPLETE)).toContain('ul. Przykładowa 1, 00-001 Warszawa');
    expect(allText(COMPLETE)).toContain('rodo@mitax.pl');
  });

  it('pozostaje projektem, dopóki prawnik nie zatwierdzi treści (nawet przy kompletnych danych)', () => {
    for (const reviewed of [null, '', '   ']) {
      expect(buildPrivacyPolicy({ ...COMPLETE, legalReviewedAt: reviewed }).isDraft, JSON.stringify(reviewed)).toBe(true);
    }
  });

  it('pozostaje projektem, gdy czegokolwiek brakuje, mimo zatwierdzenia', () => {
    expect(buildPrivacyPolicy({ ...COMPLETE, retention: null }).isDraft).toBe(true);
    expect(buildPrivacyPolicy({ ...COMPLETE, retention: '   ' }).isDraft).toBe(true);
    expect(buildPrivacyPolicy({ ...COMPLETE, controller: { ...COMPLETE.controller, address: null } }).missing).toEqual(['adres siedziby administratora']);
  });
});

describe('treść spełnia elementy art. 13 RODO i jest spójna z resztą aplikacji', () => {
  const text = allText(COMPLETE);
  const headings = buildPrivacyPolicy(COMPLETE).sections.map((s) => s.heading.replace(/^\d+\.\s*/, ''));

  it('zawiera: administratora, cele i podstawy, odbiorców, EOG, okres, prawa, skargę do UODO, dobrowolność, brak zautomatyzowanych decyzji', () => {
    for (const fragment of [
      'Administratorem Twoich danych osobowych jest MITAX Consulting sp. z o.o.',
      'art. 6 ust. 1 lit. f RODO',
      'Odbiorcy danych',
      'poza Europejski Obszar Gospodarczy',
      'Jak długo przechowujemy dane',
      'prawo do:',
      'sprostowania',
      'usunięcia',
      'ograniczenia przetwarzania',
      'przenoszenia',
      'sprzeciwu',
      'Prezesa Urzędu Ochrony Danych Osobowych',
      'Podanie danych jest dobrowolne',
      'nie dokonujemy profilowania',
    ]) {
      expect(`${headings.join('\n')}\n${text}`, fragment).toContain(fragment.replace('prawo do:', 'Przysługuje Ci prawo do:'));
    }
  });

  it('te same podstawy prawne jak w klauzuli przy CTA (spójność dokumentów)', () => {
    expect(text).toContain('art. 6 ust. 1 lit. b i f RODO');
    expect(DEFAULT_CTA_NOTICE).toContain('art. 6 ust. 1 lit. b i f RODO');
  });

  it('kalkulator nie zbiera zgód marketingowych, tak jak mówi klauzula przy CTA', () => {
    expect(text).toMatch(/nie zbiera zgód marketingowych/);
    expect(DEFAULT_CTA_NOTICE).toMatch(/Nie zbieramy tu żadnych zgód marketingowych/);
  });

  it('powiadomienia dla konsultantów nie zawierają danych klienta (zgodnie z kodem src/notify)', () => {
    expect(text).toContain('nie zawierają danych Twojej firmy ani adresu e-mail');
  });

  it('nie obiecuje niczego, czego aplikacja nie robi: brak cookies i narzędzi analitycznych', () => {
    expect(text).toContain('nie używa plików cookies, narzędzi analitycznych ani marketingowych');
  });
});

describe('splitPlaceholders i formatNip', () => {
  it('wyróżnia znaczniki „[do uzupełnienia: …]”, resztę zostawia zwykłym tekstem', () => {
    expect(splitPlaceholders('Siedziba: [do uzupełnienia: adres], kontakt: [do uzupełnienia: e-mail].')).toEqual([
      { text: 'Siedziba: ', placeholder: false },
      { text: '[do uzupełnienia: adres]', placeholder: true },
      { text: ', kontakt: ', placeholder: false },
      { text: '[do uzupełnienia: e-mail]', placeholder: true },
      { text: '.', placeholder: false },
    ]);
  });
  it('tekst bez znaczników i zwykłe nawiasy kwadratowe nie są wyróżniane', () => {
    expect(splitPlaceholders('zwykły tekst')).toEqual([{ text: 'zwykły tekst', placeholder: false }]);
    expect(splitPlaceholders('[uwaga] tekst')).toEqual([{ text: '[uwaga] tekst', placeholder: false }]);
    expect(splitPlaceholders('')).toEqual([]);
  });
  it('NIP: 10 cyfr formatowane, inne wartości bez zmian', () => {
    expect(formatNip('6152043432')).toBe('615-204-34-32');
    expect(formatNip('123')).toBe('123');
  });
});
