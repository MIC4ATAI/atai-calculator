import { describe, expect, it } from 'vitest';
import { buildGuestView } from '../session/guestView.ts';
import { buildCtaNotice, DEFAULT_CTA_NOTICE, MAX_NOTICE_LENGTH, MAX_NOTICE_PARAGRAPHS } from './notice.ts';

const org = (over: Partial<Parameters<typeof buildCtaNotice>[0]> = {}) => ({
  name: 'MITAX Consulting sp. z o.o.',
  privacy_policy_url: 'https://mitax.pl/polityka-prywatnosci',
  cta_notice: null,
  ...over,
});

describe('buildCtaNotice — treść domyślna', () => {
  const n = buildCtaNotice(org());

  it('nazywa administratora (organizację), cel, prawa i skargę do UODO', () => {
    const text = n.paragraphs.join('\n');
    expect(text).toContain('Administratorem Twoich danych osobowych jest MITAX Consulting sp. z o.o.');
    expect(text).toContain('przesłać Ci kalkulację oraz link do sesji');
    expect(text).toContain('prawo dostępu');
    expect(text).toContain('skargi do Prezesa UODO');
  });

  it('to informacja, nie zgoda: wprost mówi, że nie zbiera zgód marketingowych', () => {
    expect(n.paragraphs.join(' ')).toContain('Nie zbieramy tu żadnych zgód marketingowych');
    expect(n.paragraphs.join(' ').toLowerCase()).not.toContain('wyrażam zgodę');
  });

  it('link do polityki prywatności organizacji i jej nazwa', () => {
    expect(n.privacyUrl).toBe('https://mitax.pl/polityka-prywatnosci');
    expect(n.organization).toBe('MITAX Consulting sp. z o.o.');
  });

  it('puste, białe znaki i brak treści własnej → domyślna', () => {
    for (const empty of [null, undefined, '', '   ', '\n\n \t']) {
      expect(buildCtaNotice(org({ cta_notice: empty })).paragraphs).toEqual(n.paragraphs);
    }
  });

  it('stała domyślna ma placeholder organizacji (nigdy nie wychodzi do klienta w surowej postaci)', () => {
    expect(DEFAULT_CTA_NOTICE).toContain('{organization}');
    expect(n.paragraphs.join('')).not.toContain('{organization}');
  });
});

describe('buildCtaNotice — treść własna organizacji', () => {
  it('akapity po pustej linii, {organization} podmieniane, pojedyncze końce linii zwijane', () => {
    const n = buildCtaNotice(
      org({ cta_notice: 'Administrator: {organization}.\n\nCel: wysyłka\nkalkulacji.\r\n\r\nPrawa: dostęp, usunięcie.' }),
    );
    expect(n.paragraphs).toEqual(['Administrator: MITAX Consulting sp. z o.o.', 'Cel: wysyłka kalkulacji.', 'Prawa: dostęp, usunięcie.']);
  });

  it('treść z bazy jest zwykłym tekstem: znaczniki HTML zostają tekstem (React je escapuje), znaki sterujące znikają', () => {
    const n = buildCtaNotice(org({ cta_notice: 'Uwaga <script>alert(1)</script> i <b>pogrubienie</b>\u0000\u0007\u2028 koniec' }));
    expect(n.paragraphs).toHaveLength(1);
    expect(n.paragraphs[0]).toContain('<script>alert(1)</script>');
    expect(n.paragraphs[0]).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u2028\u2029]/);
  });

  it('kropka kończąca nazwę organizacji nie dubluje kropki szablonu; wielokropek zostaje', () => {
    expect(buildCtaNotice(org()).paragraphs[0]).toBe('Administratorem Twoich danych osobowych jest MITAX Consulting sp. z o.o.');
    expect(buildCtaNotice(org({ name: 'Biuro X', cta_notice: 'Administrator: {organization}. Koniec...' })).paragraphs[0]).toBe('Administrator: Biuro X. Koniec...');
    expect(buildCtaNotice(org({ name: 'Biuro X' })).paragraphs[0]).toBe('Administratorem Twoich danych osobowych jest Biuro X.');
  });

  it('ogranicza liczbę akapitów i całkowitą długość (widok klienta nie rośnie bez końca)', () => {
    const many = buildCtaNotice(org({ cta_notice: Array.from({ length: 30 }, (_, i) => `Akapit numer ${i + 1} z treścią.`).join('\n\n') }));
    expect(many.paragraphs.length).toBeLessThanOrEqual(MAX_NOTICE_PARAGRAPHS);
    const long = buildCtaNotice(org({ cta_notice: 'a'.repeat(5000) }));
    expect(long.paragraphs.join('').length).toBeLessThanOrEqual(MAX_NOTICE_LENGTH);
    expect(long.paragraphs[0]!.endsWith('…')).toBe(true);
  });
});

describe('buildCtaNotice — link do polityki prywatności', () => {
  it('tylko https; niebezpieczne i niepoprawne adresy dają brak linku (klauzula nadal się wyświetla)', () => {
    for (const bad of [
      'javascript:alert(1)',
      'http://mitax.pl/polityka',
      'data:text/html,<script>alert(1)</script>',
      'https://user:pass@mitax.pl/p',
      '//mitax.pl/p',
      'mitax.pl/polityka',
      'ftp://mitax.pl',
      '',
      null,
      undefined,
    ]) {
      const n = buildCtaNotice(org({ privacy_policy_url: bad }));
      expect(n.privacyUrl, String(bad)).toBeNull();
      expect(n.paragraphs.length).toBeGreaterThan(0);
    }
  });

  it('poprawny https jest normalizowany', () => {
    expect(buildCtaNotice(org({ privacy_policy_url: ' https://Mitax.pl/Polityka ' })).privacyUrl).toBe('https://mitax.pl/Polityka');
  });
});

describe('buildCtaNotice — nazwa organizacji', () => {
  it('nazwa jest jedną linią bez znaczników; brak nazwy ma bezpieczny zamiennik', () => {
    expect(buildCtaNotice(org({ name: 'Biuro <b>X</b>\nsp. z o.o.' })).organization).not.toContain('<');
    expect(buildCtaNotice(org({ name: null })).organization).toBe('organizacja prowadząca rozmowę');
    expect(buildCtaNotice(org({ name: '' })).paragraphs[0]).toContain('organizacja prowadząca rozmowę');
  });
});

describe('widok rozmówcy niesie klauzulę z organizacji', () => {
  const row = { inputs: {}, params: {}, revealed: false, mix_kh: null, reply: '' };

  it('z danymi organizacji: klauzula, bez cichych założeń i bez innych pól organizacji', () => {
    const v = buildGuestView({ ...row, organization: org() });
    expect(v.notice?.organization).toBe('MITAX Consulting sp. z o.o.');
    expect(Object.keys(v.notice!).sort()).toEqual(['organization', 'paragraphs', 'privacyUrl']);
  });

  it('bez danych organizacji: brak klauzuli (null), widok działa dalej', () => {
    expect(buildGuestView(row).notice).toBeNull();
    expect(buildGuestView({ ...row, organization: null }).notice).toBeNull();
  });
});
