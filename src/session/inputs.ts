/**
 * Dane wpisywane przez rozmówcę: dozwolone pola i ich filtr. Osobny moduł (bez zależności od kalkulatora),
 * żeby importowały go zarówno guestView, jak i logika follow-upu bez importu kołowego.
 */
/** Pola, które wpisuje rozmówca (kształt UI, jak w prototypie; efektywność w %). */
export const GUEST_INPUT_KEYS = ['kh', 'kpir', 'prac', 'przychod', 'koszty', 'ef', 'wspCzas', 'wspCena'] as const;
export type GuestInputKey = (typeof GUEST_INPUT_KEYS)[number];

/** Wartość pola: liczba albo '' (pole wyczyszczone). */
export type InputValue = number | '';
export type SessionInputs = Partial<Record<GuestInputKey, InputValue>>;

/** Górne ograniczenie wartości z formularza — chroni przed absurdalnymi liczbami. */
const MAX_INPUT_VALUE = 1e12;

/** Zostawia tylko dozwolone pola z liczbami (lub ''), resztę odrzuca. Lustro filtra SQL private.filter_inputs. */
export function sanitizeInputs(raw: unknown): SessionInputs {
  const out: SessionInputs = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  for (const key of GUEST_INPUT_KEYS) {
    if (!Object.hasOwn(obj, key)) continue; // tylko własne pola, bez dziedziczonych po prototypie
    const v = obj[key];
    if (v === '') out[key] = '';
    else if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_INPUT_VALUE) out[key] = v;
  }
  return out;
}
