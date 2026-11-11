/**
 * E2E: follow-up po stronie rozmówcy (`guest-session`): wizyta przy otwarciu strony, stan z rozmowy w widoku,
 * różnica względem bieżącej symulacji i „Wróć do stanu z rozmowy” (akcja `restore`).
 * Prawdziwe Edge Functions i baza; kalkulacja jest wysyłana do lokalnego Mailpita (jak w calculation.e2e.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, callFn, deleteMailsTo, fillExample, newSession, reveal, unique, type TestSession } from './helpers';

const NIP = '5261040567';
const emails: string[] = [];

afterAll(async () => {
  await deleteMailsTo(emails);
});

const visitsOf = async (sessionId: string): Promise<number> => {
  const { count, error } = await admin.from('session_visits').select('id', { count: 'exact', head: true }).eq('session_id', sessionId);
  if (error) throw error;
  return count ?? 0;
};

const outboxKinds = async (sessionId: string): Promise<string[]> => {
  const { data, error } = await admin.from('notification_outbox').select('kind').eq('session_id', sessionId).order('id');
  if (error) throw error;
  return (data ?? []).map((r) => r.kind);
};

const view = async (token: string, visit = false) => (await callFn('guest-session', visit ? { action: 'get', token, visit: true } : { action: 'get', token })).body.view;

describe('przed zamrożeniem stanu follow-up nie istnieje', () => {
  it('wizyta i widok: brak followUp, brak wizyt, brak alertów; restore → 409 no_snapshot', async () => {
    const session = await newSession('fu-before');
    await fillExample(session.token);
    await reveal(session.id);

    const v = await view(session.token, true);
    expect(v.followUp).toBeNull();
    expect(await visitsOf(session.id)).toBe(0);
    expect(await outboxKinds(session.id)).toEqual([]);
    expect(await callFn('guest-session', { action: 'restore', token: session.token })).toMatchObject({
      status: 409,
      body: { error: 'no_snapshot' },
    });
  });

  it('restore: nieznana sesja → 404, zły token → 400, zarchiwizowana → 404', async () => {
    expect((await callFn('guest-session', { action: 'restore', token: 'e2e-nie-istnieje-123' })).status).toBe(404);
    expect((await callFn('guest-session', { action: 'restore', token: 'x' })).status).toBe(400);
    const session = await newSession('fu-arch');
    await admin.from('calc_sessions').update({ status: 'archived' }).eq('id', session.id);
    expect((await callFn('guest-session', { action: 'restore', token: session.token })).status).toBe(404);
  });

  it('zła flaga wizyty → 400 (nie zgadujemy)', async () => {
    const session = await newSession('fu-flag');
    expect((await callFn('guest-session', { action: 'get', token: session.token, visit: 'tak' })).status).toBe(400);
  });
});

describe('po CTA: wizyty, różnica i przywrócenie stanu', () => {
  let session: TestSession;

  beforeAll(async () => {
    session = await newSession('fu-flow');
    expect((await callFn('lookup-company', { token: session.token, nip: NIP })).status).toBe(200);
    await fillExample(session.token);
    await reveal(session.id, 10);
    const email = `rozmowca-${unique()}@e2e.test`;
    emails.push(email);
    expect((await callFn('request-calculation', { token: session.token, email })).status).toBe(200);
  });

  it('widok niesie stan z rozmowy ze snapshotu i zerową różnicę; nie wyciąga kosztów ani założeń', async () => {
    const v = await view(session.token);
    expect(v.followUp.conversation).toMatchObject({ nowiKh: 10, nowiKpir: 20 });
    expect(v.followUp.conversation.godziny).toBeCloseTo(120.96, 2);
    expect(v.followUp.comparison).toMatchObject({ changed: false, deltaGodziny: 0, deltaKh: 0, deltaKpir: 0, versionDiffers: false });
    const json = JSON.stringify(v.followUp);
    for (const hidden of ['kosztMies', 'efektywneGodziny', 'celKorzysci', 'params', 'inputs']) expect(json).not.toContain(hidden);
  });

  it('zwykłe odświeżenie nie jest wizytą; otwarcie strony jest, i tylko raz w oknie 30 min', async () => {
    await view(session.token);
    expect(await visitsOf(session.id)).toBe(0);

    await view(session.token, true);
    expect(await visitsOf(session.id)).toBe(1);
    expect(await outboxKinds(session.id)).toEqual(['client_returned']);

    await view(session.token, true);
    await view(session.token, true);
    expect(await visitsOf(session.id)).toBe(1);
    expect(await outboxKinds(session.id)).toEqual(['client_returned']);
  });

  it('zmiana klienta: różnica liczona względem snapshotu; w wizycie jeden alert „zmienił dane”', async () => {
    await callFn('guest-session', { action: 'patch', token: session.token, patch: { prac: 12, koszty: 1_800_000 } });
    await callFn('guest-session', { action: 'patch', token: session.token, patch: { prac: 13 } });

    const v = await view(session.token);
    expect(v.followUp.comparison.changed).toBe(true);
    expect(v.followUp.comparison.deltaGodziny).toBeCloseTo(v.result.godzinyDoOdzyskania - v.followUp.conversation.godziny, 6);
    expect(v.followUp.conversation.godziny).toBeCloseTo(120.96, 2); // stan z rozmowy się nie zmienia

    expect(await visitsOf(session.id)).toBe(1);
    expect(await outboxKinds(session.id)).toEqual(['client_returned', 'client_changed']);
  });

  it('zmiana miksu suwakiem też jest zmianą względem rozmowy', async () => {
    await callFn('guest-session', { action: 'patch', token: session.token, mixKh: 3 });
    const v = await view(session.token);
    expect(v.followUp.comparison).toMatchObject({ changed: true, deltaKh: 3 - 10 });
  });

  it('„Wróć do stanu z rozmowy”: dane i miks jak w snapshocie, snapshot nietknięty, zmiany w dzienniku jako klient', async () => {
    const { data: snapshotBefore } = await admin.from('calc_snapshots').select('*').eq('session_id', session.id).single();

    const r = await callFn('guest-session', { action: 'restore', token: session.token });
    expect(r.status).toBe(200);
    expect(r.body.view.followUp.comparison).toMatchObject({ changed: false, deltaGodziny: 0, deltaKh: 0, deltaKpir: 0 });
    expect(r.body.view.inputs).toEqual({ kh: 100, kpir: 200, prac: 9, przychod: 2_000_000, koszty: 1_200_000 });
    expect(r.body.view.mixKh).toBe(10);

    const { data: live } = await admin.from('calc_sessions').select('inputs, mix_kh').eq('id', session.id).single();
    expect(live).toEqual({ inputs: snapshotBefore!.inputs, mix_kh: 10 });

    const { data: snapshotAfter } = await admin.from('calc_snapshots').select('*').eq('session_id', session.id).single();
    expect(snapshotAfter).toEqual(snapshotBefore);

    const { data: events } = await admin
      .from('calc_events')
      .select('actor, old_value, new_value')
      .eq('session_id', session.id)
      .eq('field', 'prac')
      .order('id');
    expect(events!.at(-1)).toEqual({ actor: 'guest', old_value: 13, new_value: 9 });
  });

  it('powtórne „Wróć…” bez zmian jest bezpieczne (nic się nie zmienia, nie przybywa alertów ani wizyt)', async () => {
    const before = await outboxKinds(session.id);
    const r = await callFn('guest-session', { action: 'restore', token: session.token });
    expect(r.status).toBe(200);
    expect(r.body.view.followUp.comparison.changed).toBe(false);
    expect(await outboxKinds(session.id)).toEqual(before);
    expect(await visitsOf(session.id)).toBe(1);
  });

  it('przywracanie usuwa także pole dopisane po rozmowie', async () => {
    await callFn('guest-session', { action: 'patch', token: session.token, patch: { ef: 70 } });
    expect((await view(session.token)).inputs.ef).toBe(70);
    const r = await callFn('guest-session', { action: 'restore', token: session.token });
    expect(r.body.view.inputs.ef).toBeUndefined();
    expect(r.body.view.followUp.comparison.changed).toBe(false);
  });

  it('wynik ukryty przez konsultanta ukrywa też follow-up', async () => {
    await admin.from('calc_sessions').update({ revealed: false }).eq('id', session.id);
    expect((await view(session.token)).followUp).toBeNull();
    await admin.from('calc_sessions').update({ revealed: true }).eq('id', session.id);
    expect((await view(session.token)).followUp).not.toBeNull();
  });
});
