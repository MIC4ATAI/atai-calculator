/**
 * Flaga konfiguracyjna: czy mail z kalkulacją zawiera zaproszenie na landing page organizacji.
 *
 * TYMCZASOWA: landing page'e ze zgodami powstają w etapie 4, więc do tego czasu zaproszenie jest domyślnie WYŁĄCZONE
 * (mail wysyłamy wyłącznie dlatego, że rozmówca o niego poprosił; brak strony, na którą zaproszenie prowadziłoby, to
 * martwy link w wiadomości do klienta). Włączasz je zmienną `MAIL_LANDING_INVITATION=on` w środowisku funkcji, gdy
 * strona organizacji istnieje. Zaproszenie pojawia się tylko, gdy flaga jest włączona ORAZ organizacja ma `landingUrl`.
 *
 * Bezpieczne domyślne: każda wartość inna niż jawne „włączone” oznacza wyłączone (literówka nie włączy zaproszenia).
 */
import type { EnvReader } from './mailer.ts';

const ON = new Set(['on', 'true', '1', 'yes', 'tak']);

export function isLandingInvitationEnabled(env: EnvReader): boolean {
  return ON.has((env('MAIL_LANDING_INVITATION') ?? '').trim().toLowerCase());
}
