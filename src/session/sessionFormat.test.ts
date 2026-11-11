import { describe, expect, it } from 'vitest';
import { formatDateTime, guestLink, statusLabel, toSessionStatus } from './sessionFormat';

describe('guestLink', () => {
  it('buduje link do widoku rozmówcy', () => {
    expect(guestLink('https://atai.mitax.pl', 'abc123')).toBe('https://atai.mitax.pl/s/abc123');
  });
  it('nie dubluje ukośnika na końcu adresu', () => {
    expect(guestLink('http://127.0.0.1:5173/', 'abc')).toBe('http://127.0.0.1:5173/s/abc');
    expect(guestLink('http://127.0.0.1:5173///', 'abc')).toBe('http://127.0.0.1:5173/s/abc');
  });
});

describe('status', () => {
  it('mapuje znane statusy na polskie etykiety', () => {
    expect(statusLabel('live')).toBe('Na żywo');
    expect(statusLabel('shared')).toBe('Udostępniona');
    expect(statusLabel('archived')).toBe('Zarchiwizowana');
  });
  it('nieznany status traktuje jak „live”', () => {
    expect(toSessionStatus('coś-nowego')).toBe('live');
    expect(toSessionStatus('archived')).toBe('archived');
  });
});

describe('formatDateTime', () => {
  it('formatuje poprawną datę', () => {
    expect(formatDateTime('2026-11-11T15:30:00Z')).toMatch(/2026/);
  });
  it('niepoprawna data → myślnik zamiast „Invalid Date”', () => {
    expect(formatDateTime('nie-data')).toBe('–');
  });
});
