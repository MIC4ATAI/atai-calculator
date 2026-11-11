// Klient Supabase z kluczem service role — wyłącznie po stronie serwera (Edge Functions).
// Ten klucz nigdy nie trafia do przeglądarki ani do repozytorium: Supabase wstrzykuje go do środowiska funkcji.
import { createClient } from 'npm:@supabase/supabase-js@2';

export const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
