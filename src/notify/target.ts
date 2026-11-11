/**
 * Adresat powiadomień w profilu konsultanta (Telegram chat id). Lustro ograniczeń z bazy
 * (`profiles_notify_target_check`, `profiles_notify_pair`): oba pola albo żadne, identyfikator to liczba całkowita
 * (czaty grupowe i kanały mają ujemne), 5–20 cyfr.
 */
export const NOTIFY_CHANNELS = ['telegram'] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

const CHAT_ID = /^-?[0-9]{5,20}$/;

export type TargetResult =
  | { ok: true; channel: NotifyChannel | null; target: string | null }
  | { ok: false; error: string };

/** Pusty identyfikator wyłącza powiadomienia (oba pola null); niepoprawny jest odrzucany z komunikatem po polsku. */
export function validateNotifyTarget(channel: string, rawTarget: string): TargetResult {
  const target = rawTarget.trim();
  if (target === '') return { ok: true, channel: null, target: null };
  if (!(NOTIFY_CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: 'Wybierz kanał powiadomień.' };
  if (!CHAT_ID.test(target)) {
    return { ok: false, error: 'Identyfikator czatu to liczba (5–20 cyfr, w grupach z minusem na początku).' };
  }
  return { ok: true, channel: channel as NotifyChannel, target };
}
