/**
 * Publiczny adres aplikacji do linków dla rozmówcy.
 *
 * Link rozmówcy (`/s/<token>`) ma otwierać się bez logowania, więc musi wskazywać PUBLICZNĄ domenę (np. atai.mitax.pl).
 * Bez tej zmiennej link powstaje z adresu, z którego konsultant otworzył aplikację; jeśli był to adres chroniony
 * (np. podgląd lub alias zespołu na Vercelu), rozmówca trafiłby na logowanie Vercela. `VITE_PUBLIC_APP_URL` wskazuje
 * adres kanoniczny niezależnie od tego, gdzie loguje się konsultant.
 *
 * To NIE jest sekret (trafia do przeglądarki). Adres logowania (`emailRedirectTo`) zostaje bez zmian: logowanie ma wrócić
 * tam, gdzie się odbyło.
 */

/** Hosty, dla których dopuszczamy http (lokalny rozwój). Reszta wymaga https. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Adres z konfiguracji (tylko origin: schemat, host i port) albo `currentOrigin`, gdy konfiguracja jest pusta lub
 * niepoprawna. Niepoprawna wartość nie może zepsuć linków, więc wracamy do bieżącego adresu zamiast rzucać wyjątek.
 */
export function resolvePublicOrigin(configured: string | undefined, currentOrigin: string): string {
  const raw = configured?.trim();
  if (!raw) return currentOrigin;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return currentOrigin;
  }
  const secure = url.protocol === 'https:';
  const localHttp = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  if ((!secure && !localHttp) || url.username !== '' || url.password !== '') return currentOrigin;
  return url.origin;
}

/** Adres publiczny dla linków rozmówcy w bieżącej aplikacji (zmienna `VITE_PUBLIC_APP_URL`, w przeciwnym razie origin). */
export function publicAppOrigin(): string {
  return resolvePublicOrigin(import.meta.env.VITE_PUBLIC_APP_URL, window.location.origin);
}
