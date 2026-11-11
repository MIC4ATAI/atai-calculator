/**
 * Porównanie sekretów w stałym czasie (bez zdradzania, ile pierwszych znaków się zgadza). Oba napisy są najpierw
 * skracane funkcją SHA-256 do tej samej długości, więc czas porównania nie zależy od ich długości ani zawartości.
 */
const encoder = new TextEncoder();

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

export async function secretsEqual(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Minimalna długość sekretu wywołującego dispatch (zadanie crona i ręczne wywołania). */
export const MIN_DISPATCH_SECRET_LENGTH = 32;
