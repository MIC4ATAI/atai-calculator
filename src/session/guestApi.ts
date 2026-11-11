import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { GuestView, SessionInputs } from './guestView';

export type GuestCall =
  | { action: 'get'; token: string }
  | { action: 'patch'; token: string; patch: SessionInputs; mixKh?: number; reply?: string };

export type GuestCallResult =
  | { ok: true; view: GuestView }
  | { ok: false; kind: 'not_found' | 'unavailable' };

/**
 * Wywołanie Edge Function `guest-session`. Rozmówca nie ma dostępu do tabel — tylko do tej funkcji.
 * 404 = sesja nie istnieje lub jest zarchiwizowana; wszystko inne (sieć, 5xx) traktujemy jako chwilową niedostępność.
 */
export async function callGuest(body: GuestCall): Promise<GuestCallResult> {
  const { data, error } = await supabase.functions.invoke<{ view: GuestView }>('guest-session', { body });
  if (error) {
    if (error instanceof FunctionsHttpError && error.context instanceof Response && error.context.status === 404) {
      return { ok: false, kind: 'not_found' };
    }
    return { ok: false, kind: 'unavailable' };
  }
  if (!data?.view) return { ok: false, kind: 'unavailable' };
  return { ok: true, view: data.view };
}
