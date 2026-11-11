/**
 * E2E: dostęp rozmówcy po tokenie (`guest-session`) — niezmienniki bezpieczeństwa z etapu 1 i nowy stan z etapu 2.
 * Rozmówca nie ma dostępu do tabel: widzi tylko bezpieczny widok sesji.
 */
import { describe, expect, it } from 'vitest';
import { admin, API_URL, callFn, fillExample, newSession, reveal, unique } from './helpers';

describe('guest-session', () => {
  it('przed odsłonięciem: brak wyniku i brak cichych założeń; CTA zablokowane powodem „nie odsłonięto”', async () => {
    const session = await newSession('guest-view');
    await fillExample(session.token);

    const r = await callFn('guest-session', { action: 'get', token: session.token });
    expect(r.status).toBe(200);
    const view = r.body.view;
    expect(view.revealed).toBe(false);
    expect(view.result).toBeNull();
    expect(view.company).toBeNull();
    expect(view.nipLocked).toBe(false);
    expect(view.cta).toMatchObject({ available: false, blockedReason: 'not_revealed', sentCount: 0, remaining: 3, emailMasked: null });
    expect(JSON.stringify(r.body)).not.toContain('params');
  });

  it('zapis rozmówcy przyjmuje tylko dozwolone pola: NIP, firma i ciche założenia są ignorowane', async () => {
    const session = await newSession('guest-patch');
    const r = await callFn('guest-session', {
      action: 'patch',
      token: session.token,
      patch: { kh: 10, nip: '5260250995', company: { name: 'FIKCYJNA' }, celKorzysci: 1, params: { celKorzysci: 1 } },
      mixKh: 3,
      reply: 'Dzień dobry',
    });
    expect(r.status).toBe(200);
    expect(r.body.view.inputs).toEqual({ kh: 10 });
    expect(r.body.view.company).toBeNull();

    const { data } = await admin.from('calc_sessions').select('params, company_id, mix_kh, reply').eq('id', session.id).single();
    expect(data).toEqual({ params: {}, company_id: null, mix_kh: 3, reply: 'Dzień dobry' });
  });

  it('po odsłonięciu: wynik zgodny z przykładem kontrolnym, ale bez kosztów wewnętrznych i bez cichych założeń', async () => {
    const session = await newSession('guest-result');
    await fillExample(session.token);
    await reveal(session.id);

    const r = await callFn('guest-session', { action: 'get', token: session.token });
    const result = r.body.view.result;
    expect(result.godzinyDoOdzyskania).toBeCloseTo(120.96, 2);
    expect(result.maksNowychKh).toBe(20);
    expect(result.mixes).toHaveLength(21);

    const json = JSON.stringify(r.body);
    for (const hidden of ['kosztMies', 'efektywneGodziny', 'kosztGodziny', 'dniRobocze', 'godzinyDziennie', '"params"']) {
      expect(json).not.toContain(hidden);
    }
  });

  it('zarchiwizowana lub nieznana sesja: 404; złe metody i ciało', async () => {
    const session = await newSession('guest-arch');
    await admin.from('calc_sessions').update({ status: 'archived' }).eq('id', session.id);
    expect((await callFn('guest-session', { action: 'get', token: session.token })).status).toBe(404);
    expect((await callFn('guest-session', { action: 'get', token: 'e2e-nie-istnieje-123' })).status).toBe(404);
    expect((await callFn('guest-session', { action: 'delete', token: session.token })).status).toBe(400);

    const get = await fetch(`${API_URL}/functions/v1/guest-session`, { headers: { apikey: process.env.E2E_PUBLISHABLE_KEY! } });
    expect(get.status).toBe(405);
  });
});

describe('klauzula informacyjna RODO przy CTA (treść i link z organizacji)', () => {
  const ATAI = '10000000-0000-4000-8000-000000000002';
  const JAN = '00000000-0000-4000-8000-000000000006';

  it('MITAX bez własnej treści: domyślna klauzula z nazwą administratora i linkiem do polityki prywatności', async () => {
    const session = await newSession('notice-default');
    const { notice } = (await callFn('guest-session', { action: 'get', token: session.token })).body.view;
    expect(notice.organization).toBe('MITAX Consulting sp. z o.o.');
    expect(notice.privacyUrl).toBe('https://mitax.test/polityka-prywatnosci');
    const text = notice.paragraphs.join('\n');
    expect(text).toContain('Administratorem Twoich danych osobowych jest MITAX Consulting sp. z o.o.');
    expect(text).toContain('Nie zbieramy tu żadnych zgód marketingowych');
    expect(Object.keys(notice).sort()).toEqual(['organization', 'paragraphs', 'privacyUrl']);
  });

  it('AT AI ma własną treść z podmienioną nazwą organizacji i własny link — klauzule organizacji się nie mieszają', async () => {
    const token = `e2e-notice-atai-${unique()}${unique()}`;
    const { error } = await admin.from('calc_sessions').insert({ org_id: ATAI, consultant_id: JAN, token });
    expect(error).toBeNull();
    const { notice } = (await callFn('guest-session', { action: 'get', token })).body.view;
    expect(notice.organization).toBe('AT AI Solutions');
    expect(notice.privacyUrl).toBe('https://atai.test/privacy');
    expect(notice.paragraphs).toEqual([
      'Administratorem Twoich danych jest AT AI Solutions.',
      'Adres e-mail wykorzystamy tylko do wysłania kalkulacji, o którą prosisz.',
    ]);
    expect(JSON.stringify(notice)).not.toContain('MITAX');
  });
});

