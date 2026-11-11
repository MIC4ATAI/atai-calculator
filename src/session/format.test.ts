import { describe, expect, it } from 'vitest';
import { minSec, nf, zl } from './format';

/** Intl wstawia twarde spacje jako separator tysięcy — w testach porównujemy ze zwykłą spacją. */
const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('nf / zl', () => {
  it('formatuje liczby po polsku', () => {
    expect(plain(nf(22_222.2))).toBe('22 222');
    expect(nf(120.96, 1)).toBe('121,0');
    expect(nf(36.288, 0)).toBe('36');
  });
  it('złotówki', () => {
    expect(plain(zl(22_222.2))).toBe('22 222 zł');
    expect(zl(10_000)).toMatch(/10\s?000 zł/);
  });
  it('brak lub niepoprawna wartość → myślnik', () => {
    for (const v of [null, undefined, NaN, Infinity]) {
      expect(nf(v)).toBe('–');
      expect(zl(v)).toBe('–');
    }
  });
});

describe('minSec', () => {
  it('przykład kontrolny: 36 min/mies. na kliencie KH to 1 min 44 s dziennie', () => {
    expect(minSec(1.728)).toBe('1 min 44 s');
    expect(minSec(36.288)).toBe('36 min');
  });
  it('poniżej minuty tylko sekundy', () => {
    expect(minSec(0.5)).toBe('30 s');
  });
  it('próg 3 minut', () => {
    expect(minSec(3)).toBe('3 min');
    expect(minSec(2.99)).toMatch(/^2 min 59 s$|^3 min 0 s$/);
  });
  it('niepoprawna wartość', () => {
    expect(minSec(NaN)).toBe('–');
  });
});
