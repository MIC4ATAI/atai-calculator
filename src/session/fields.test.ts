import { describe, expect, it } from 'vitest';
import { liveRow } from './fields.ts';

describe('liveRow (wiersz widoku „na żywo” u prezentera)', () => {
  it('brak wpisu w polu z podpowiedzią: pokazujemy wartość domyślną ze znacznikiem, nie napis', () => {
    expect(liveRow('wspCzas', undefined)).toEqual({ value: 2, isDefault: true });
    expect(liveRow('wspCena', undefined)).toEqual({ value: 4, isDefault: true });
    expect(liveRow('ef', undefined)).toEqual({ value: 80, isDefault: true });
  });
  it('puste pole to to samo co brak wpisu (kalkulacja używa wtedy wartości domyślnej)', () => {
    expect(liveRow('ef', '')).toEqual({ value: 80, isDefault: true });
    expect(liveRow('wspCzas', '')).toEqual({ value: 2, isDefault: true });
  });
  it('wpisana wartość podpowiedzi też jest oznaczona jako domyślna (po powrocie do wartości początkowej)', () => {
    expect(liveRow('ef', 80)).toEqual({ value: 80, isDefault: true });
  });
  it('inna wartość: bez znacznika', () => {
    expect(liveRow('ef', 70)).toEqual({ value: 70, isDefault: false });
    expect(liveRow('wspCzas', 3)).toEqual({ value: 3, isDefault: false });
  });
  it('pola bez wartości domyślnej: wpisana liczba bez znacznika, brak wpisu to „–” (null)', () => {
    expect(liveRow('kh', 10)).toEqual({ value: 10, isDefault: false });
    expect(liveRow('kh', undefined)).toEqual({ value: null, isDefault: false });
    expect(liveRow('przychod', '')).toEqual({ value: null, isDefault: false });
  });
});
