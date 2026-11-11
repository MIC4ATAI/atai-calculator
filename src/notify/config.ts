/**
 * Konfiguracja powiadomień dla konsultanta (webhook n8n) czytana ze zmiennych środowiskowych Edge Functions.
 * Odczyt środowiska jest wstrzykiwany (jak w src/email/mailer.ts), więc da się go przetestować bez Deno.
 *
 * Sekret podpisu i adres webhooka pochodzą wyłącznie ze środowiska funkcji — nigdy z repozytorium ani z przeglądarki
 * — i nie trafiają do logów ani komunikatów błędów.
 */
export type EnvReader = (name: string) => string | undefined;

export interface NotifyConfig {
  webhookUrl: string;
  secret: string;
  /** Adres aplikacji bez końcowego ukośnika (do linku w alercie). */
  appBaseUrl: string;
}

export type NotifyConfigResult =
  | { ok: true; config: NotifyConfig }
  /** `not_configured` = powiadomienia wyłączone (nic nie robimy, bez hałasu); reszta to błąd konfiguracji do zalogowania. */
  | { ok: false; reason: 'not_configured' | 'invalid_webhook_url' | 'weak_secret' | 'invalid_app_url' };

/** Minimalna długość sekretu podpisu; krótszy łatwo odgadnąć. */
export const MIN_SECRET_LENGTH = 16;

/** Hosty, dla których dopuszczamy http (lokalny rozwój: n8n lub odbiornik testowy na hoście). Reszta wymaga https. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);

const read = (env: EnvReader, name: string): string | undefined => {
  const value = env(name)?.trim();
  return value ? value : undefined;
};

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function readNotifyConfig(env: EnvReader): NotifyConfigResult {
  const webhookRaw = read(env, 'N8N_WEBHOOK_URL');
  if (!webhookRaw) return { ok: false, reason: 'not_configured' };

  const webhook = parseUrl(webhookRaw);
  const isLocal = webhook !== null && LOCAL_HOSTS.has(webhook.hostname);
  if (
    !webhook ||
    (webhook.protocol !== 'https:' && !(webhook.protocol === 'http:' && isLocal)) ||
    webhook.username !== '' ||
    webhook.password !== ''
  ) {
    return { ok: false, reason: 'invalid_webhook_url' };
  }

  const secret = read(env, 'N8N_WEBHOOK_SECRET');
  if (!secret || secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: 'weak_secret' };

  const appRaw = read(env, 'APP_BASE_URL');
  const app = appRaw ? parseUrl(appRaw) : null;
  if (!app || (app.protocol !== 'https:' && app.protocol !== 'http:')) return { ok: false, reason: 'invalid_app_url' };

  return {
    ok: true,
    config: { webhookUrl: webhook.toString(), secret, appBaseUrl: app.origin + app.pathname.replace(/\/+$/, '') },
  };
}
