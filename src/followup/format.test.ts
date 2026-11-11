import { describe, expect, it } from 'vitest';
import { formatDelta } from './format.ts';

describe('formatDelta', () => {
  it('znak zależy od kierunku zmiany; minus to prawdziwy znak minus', () => {
    expect(formatDelta(19)).toBe('+19');
    expect(formatDelta(-3)).toBe('−3');
  });
  it('zero i szum zmiennoprzecinkowy po zaokrągleniu to „0”, bez „+0” i „−0”', () => {
    expect(formatDelta(0)).toBe('0');
    expect(formatDelta(0.4)).toBe('0');
    expect(formatDelta(-0.4)).toBe('0');
    expect(formatDelta(1e-12)).toBe('0');
    expect(formatDelta(-1e-12)).toBe('0');
  });
  it('zaokrągla do podanej liczby miejsc po przecinku (przecinek jak w polskim zapisie)', () => {
    expect(formatDelta(2.345, 1)).toBe('+2,3');
    expect(formatDelta(-0.04, 1)).toBe('0');
    expect(formatDelta(-0.06, 1)).toBe('−0,1');
  });
  it('wartości nieskończone i NaN nie wywracają widoku', () => {
    expect(formatDelta(Number.NaN)).toBe('–');
    expect(formatDelta(Infinity)).toBe('–');
  });
});
