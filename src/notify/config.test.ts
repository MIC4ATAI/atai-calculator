import { describe, expect, it } from 'vitest';
import { readNotifyConfig, type EnvReader } from './config.ts';

const SECRET = 'sekret-do-podpisu-1234';
const env = (vars: Record<string, string | undefined>): EnvReader => (name) => vars[name];
const full = { N8N_WEBHOOK_URL: 'https://n8n.example.com/webhook/abc', N8N_WEBHOOK_SECRET: SECRET, APP_BASE_URL: 'https://atai.mitax.pl' };

describe('readNotifyConfig', () => {
  it('poprawna konfiguracja produkcyjna (https)', () => {
    expect(readNotifyConfig(env(full))).toEqual({
      ok: true,
      config: { webhookUrl: 'https://n8n.example.com/webhook/abc', secret: SECRET, appBaseUrl: 'https://atai.mitax.pl' },
    });
  });

  it('brak adresu webhooka = powiadomienia wyłączone (nie jest to błąd)', () => {
    expect(readNotifyConfig(env({ ...full, N8N_WEBHOOK_URL: undefined }))).toEqual({ ok: false, reason: 'not_configured' });
    expect(readNotifyConfig(env({ ...full, N8N_WEBHOOK_URL: '   ' }))).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('http dozwolone tylko dla hostów lokalnych; reszta wymaga https', () => {
    for (const host of ['localhost', '127.0.0.1', 'host.docker.internal', '[::1]']) {
      expect(readNotifyConfig(env({ ...full, N8N_WEBHOOK_URL: `http://${host}:54399/hook` })).ok, host).toBe(true);
    }
    for (const url of ['http://n8n.example.com/hook', 'http://10.0.0.5/hook', 'http://localhost.evil.com/hook']) {
      expect(readNotifyConfig(env({ ...full, N8N_WEBHOOK_URL: url })), url).toEqual({ ok: false, reason: 'invalid_webhook_url' });
    }
  });

  it('odrzuca adresy bez sensu, inne protokoły i dane logowania w adresie', () => {
    for (const url of ['nie url', 'ftp://n8n.example.com/x', 'javascript:alert(1)', 'https://user:pass@n8n.example.com/x', 'https://user@n8n.example.com/x']) {
      expect(readNotifyConfig(env({ ...full, N8N_WEBHOOK_URL: url })), url).toEqual({ ok: false, reason: 'invalid_webhook_url' });
    }
  });

  it('sekret krótszy niż 16 znaków albo brak → odrzucony', () => {
    expect(readNotifyConfig(env({ ...full, N8N_WEBHOOK_SECRET: 'krotki' }))).toEqual({ ok: false, reason: 'weak_secret' });
    expect(readNotifyConfig(env({ ...full, N8N_WEBHOOK_SECRET: undefined }))).toEqual({ ok: false, reason: 'weak_secret' });
    expect(readNotifyConfig(env({ ...full, N8N_WEBHOOK_SECRET: 'a'.repeat(16) })).ok).toBe(true);
  });

  it('adres aplikacji: wymagany, http/https, bez końcowego ukośnika', () => {
    expect(readNotifyConfig(env({ ...full, APP_BASE_URL: undefined }))).toEqual({ ok: false, reason: 'invalid_app_url' });
    expect(readNotifyConfig(env({ ...full, APP_BASE_URL: 'ftp://x.pl' }))).toEqual({ ok: false, reason: 'invalid_app_url' });
    const r = readNotifyConfig(env({ ...full, APP_BASE_URL: 'http://127.0.0.1:5173/' }));
    expect(r.ok && r.config.appBaseUrl).toBe('http://127.0.0.1:5173');
  });

  it('błąd konfiguracji nie zawiera sekretu ani adresu', () => {
    const r = readNotifyConfig(env({ ...full, N8N_WEBHOOK_SECRET: 'krotki' }));
    expect(JSON.stringify(r)).not.toContain('krotki');
    expect(JSON.stringify(r)).not.toContain('n8n.example.com');
  });
});
