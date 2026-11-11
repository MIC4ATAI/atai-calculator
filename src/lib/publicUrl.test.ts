import { describe, expect, it } from 'vitest';
import { resolvePublicOrigin } from './publicUrl';

const CURRENT = 'https://atai-calculator-git-production-markust71s-projects.vercel.app';

describe('resolvePublicOrigin', () => {
  it('poprawny adres publiczny ma pierwszeństwo przed bieżącym (to cały sens zmiennej)', () => {
    expect(resolvePublicOrigin('https://atai.mitax.pl', CURRENT)).toBe('https://atai.mitax.pl');
  });
  it('zostawia sam origin: ścieżka, parametry, hash i końcowy ukośnik są odrzucane', () => {
    expect(resolvePublicOrigin('https://atai.mitax.pl/', CURRENT)).toBe('https://atai.mitax.pl');
    expect(resolvePublicOrigin('https://atai.mitax.pl/app?x=1#y', CURRENT)).toBe('https://atai.mitax.pl');
    expect(resolvePublicOrigin('  https://atai.mitax.pl:8443  ', CURRENT)).toBe('https://atai.mitax.pl:8443');
  });
  it('brak lub pusta konfiguracja → bieżący adres (lokalny rozwój działa jak dotąd)', () => {
    for (const v of [undefined, '', '   ']) expect(resolvePublicOrigin(v, 'http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173');
  });
  it('http tylko dla hostów lokalnych; reszta wymaga https', () => {
    expect(resolvePublicOrigin('http://localhost:5173', CURRENT)).toBe('http://localhost:5173');
    expect(resolvePublicOrigin('http://127.0.0.1:5173', CURRENT)).toBe('http://127.0.0.1:5173');
    for (const v of ['http://atai.mitax.pl', 'http://10.0.0.5', 'http://localhost.evil.com']) {
      expect(resolvePublicOrigin(v, CURRENT), v).toBe(CURRENT);
    }
  });
  it('niepoprawne wartości nie psują linków: wracamy do bieżącego adresu', () => {
    for (const v of ['nie url', 'atai.mitax.pl', '//atai.mitax.pl', 'javascript:alert(1)', 'ftp://atai.mitax.pl', 'https://', 'https://user:pass@atai.mitax.pl']) {
      expect(resolvePublicOrigin(v, CURRENT), v).toBe(CURRENT);
    }
  });
});
