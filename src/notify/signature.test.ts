import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signPayload } from './signature.ts';

const nodeSign = (secret: string, ts: string, body: string) => `sha256=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;

describe('signPayload', () => {
  it('zgodny z HMAC-SHA256 liczonym niezależnie (Node) — tak zweryfikuje go n8n', async () => {
    const body = JSON.stringify({ eventId: 'ntf-1', ą: 'ęśż' });
    expect(await signPayload('sekret-do-podpisu-1234', '1762860000', body)).toBe(nodeSign('sekret-do-podpisu-1234', '1762860000', body));
  });

  it('podpis zależy od sekretu, znacznika czasu i treści', async () => {
    const base = await signPayload('sekret-do-podpisu-1234', '100', 'x');
    expect(await signPayload('inny-sekret-do-podpisu', '100', 'x')).not.toBe(base);
    expect(await signPayload('sekret-do-podpisu-1234', '101', 'x')).not.toBe(base);
    expect(await signPayload('sekret-do-podpisu-1234', '100', 'y')).not.toBe(base);
  });

  it('znacznik czasu musi być liczbą całkowitą (inaczej separator „.” byłby niejednoznaczny)', async () => {
    for (const bad of ['1.2', '', 'abc', '-5', '1 2', '1e9', '1'.repeat(13)]) {
      await expect(signPayload('sekret-do-podpisu-1234', bad, '3'), JSON.stringify(bad)).rejects.toThrow();
    }
    await expect(signPayload('sekret-do-podpisu-1234', '1762860000', '3')).resolves.toMatch(/^sha256=/);
  });

  it('format wartości nagłówka: sha256= i 64 znaki szesnastkowe', async () => {
    expect(await signPayload('sekret-do-podpisu-1234', '1', '')).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});
