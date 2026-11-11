/** Walidacja polskiego NIP (suma kontrolna). Akceptuje myślniki i spacje. */

const WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;

export function normalizeNip(raw: string): string {
  return raw.replace(/^PL/i, '').replace(/[\s-]/g, '');
}

export function isValidNip(raw: string): boolean {
  const nip = normalizeNip(raw);
  if (!/^\d{10}$/.test(nip)) return false;
  const digits = [...nip].map(Number);
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * digits[i], 0);
  const check = sum % 11;
  // Reszta 10 oznacza zawsze błędny NIP.
  return check !== 10 && check === digits[9];
}
