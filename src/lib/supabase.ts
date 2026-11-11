import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL;
const publicKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !publicKey) {
  throw new Error(
    'Brak konfiguracji Supabase: ustaw VITE_SUPABASE_URL i VITE_SUPABASE_ANON_KEY (zob. .env.example).',
  );
}

/** Klient przeglądarkowy — wyłącznie z publicznym kluczem. Tajne klucze żyją tylko w Edge Functions. */
export const supabase = createClient<Database>(url, publicKey);
