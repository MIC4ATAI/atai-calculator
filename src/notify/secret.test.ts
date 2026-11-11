import { describe, expect, it } from 'vitest';
import { MIN_DISPATCH_SECRET_LENGTH, secretsEqual } from './secret.ts';

describe('secretsEqual', () => {
  it('te same sekrety → true', async () => {
    expect(await secretsEqual('a'.repeat(40), 'a'.repeat(40))).toBe(true);
  });
  it('różnica na dowolnej pozycji, inna długość, pusty napis → false', async () => {
    const secret = 'sekret-do-wywolan-crona-1234567890abcdef';
    expect(await secretsEqual(secret.replace(/.$/, 'X'), secret)).toBe(false);
    expect(await secretsEqual(secret.replace(/^./, 'X'), secret)).toBe(false);
    expect(await secretsEqual(secret + 'x', secret)).toBe(false);
    expect(await secretsEqual(secret.slice(0, -1), secret)).toBe(false);
    expect(await secretsEqual('', secret)).toBe(false);
  });
  it('dwa puste napisy są równe, więc wywołujący musi najpierw odrzucić brak sekretu po swojej stronie', async () => {
    expect(await secretsEqual('', '')).toBe(true);
  });
  it('stała minimalnej długości', () => {
    expect(MIN_DISPATCH_SECRET_LENGTH).toBe(32);
  });
});
