/**
 * E2E: wyszukiwanie firmy po NIP (Edge Function `lookup-company`) na prawdziwej, publicznej bazie TESTOWEJ GUS.
 * GUS bywa wolny po zimnym starcie funkcji, więc scenariusze zależne od jego odpowiedzi ponawiają zapytanie, a gdy
 * rejestr jest niedostępny — pomijają asercje o danych z GUS (rozmowa i tak toczy się dalej; to też jest zachowanie
 * sprawdzane tutaj).
 */
import { describe, expect, it } from 'vitest';
import { admin, callFn, MITAX_ORG, newSession, randomValidNips, sleep, type FnResult } from './helpers';

const NIP_TMOBILE = '5261040567'; // działa w bazie testowej GUS

async function lookup(token: string, nip: string, tries = 3): Promise<FnResult> {
  let result = await callFn('lookup-company', { token, nip });
  for (let i = 1; i < tries && result.status === 200 && result.body?.company?.gusStatus === 'unavailable'; i += 1) {
    await sleep(2_000);
    result = await callFn('lookup-company', { token, nip });
  }
  return result;
}

describe('lookup-company', () => {
  it('poprawny NIP: widok firmy bez pól wewnętrznych, firma przypięta do sesji, zmiana w dzienniku', async (ctx) => {
    const session = await newSession('lookup');
    const r = await lookup(session.token, NIP_TMOBILE);

    expect(r.status).toBe(200);
    expect(Object.keys(r.body.company).sort()).toEqual(['address', 'gusStatus', 'name', 'nip']);
    expect(r.body.company.nip).toBe('526-104-05-67');
    const json = JSON.stringify(r.body);
    for (const hidden of ['regon', 'Regon', 'gus_raw', 'fetched_at', 'SilosID']) expect(json).not.toContain(hidden);

    const { data: row } = await admin.from('calc_sessions').select('company_id').eq('id', session.id).single();
    expect(row?.company_id).not.toBeNull();
    const { data: events } = await admin.from('calc_events').select('actor').eq('session_id', session.id).eq('field', 'company_id');
    expect(events).toEqual([{ actor: 'guest' }]);

    if (r.body.company.gusStatus === 'unavailable') return ctx.skip(); // GUS niedostępny: reszta zależy od jego danych
    expect(r.body.company.name).toBe('T-MOBILE POLSKA SPÓŁKA AKCYJNA');
    expect(r.body.company.address).toBe('ul. Test-Krucza 12, 02-674 Warszawa');
  });

  it('NIP z pamięci podręcznej: GUS nie jest pytany, dane i fetched_at bez zmian (losowy NIP, którego GUS nie zna)', async () => {
    // Test izolowany od innych plików e2e (równoległych): własna firma w cache, nieznana rejestrowi.
    const [nip] = randomValidNips(1);
    const { error } = await admin
      .from('companies')
      .insert({ org_id: MITAX_ORG, nip: nip!, name: 'FIRMA Z CACHE', city: 'Łódź', gus_status: 'found' });
    expect(error).toBeNull();
    const read = async () =>
      (await admin.from('companies').select('fetched_at').eq('org_id', MITAX_ORG).eq('nip', nip!).single()).data?.fetched_at;
    const before = await read();
    await sleep(1_100);

    const session = await newSession('lookup-cache');
    const first = await callFn('lookup-company', { token: session.token, nip: nip! });
    expect(first).toMatchObject({ status: 200, body: { company: { name: 'FIRMA Z CACHE', gusStatus: 'found' } } });

    const second = await callFn('lookup-company', { token: session.token, nip: `${nip!.slice(0, 3)}-${nip!.slice(3, 6)}-${nip!.slice(6, 8)}-${nip!.slice(8)}` });
    expect(second.status).toBe(200);
    expect(second.body.company.name).toBe('FIRMA Z CACHE');
    expect(await read()).toBe(before); // GUS nie był pytany (nie zna tego NIP-u — dostalibyśmy 422)

    const { data: events } = await admin.from('calc_events').select('id').eq('session_id', session.id).eq('field', 'company_id');
    expect(events).toHaveLength(1); // ta sama firma nie dopisuje zdarzenia
  });

  it('błędne wejście: zła suma kontrolna, zły token, nieznana sesja, zły JSON', async () => {
    const session = await newSession('lookup-bad');
    expect(await callFn('lookup-company', { token: session.token, nip: '5261040568' })).toMatchObject({ status: 400, body: { error: 'invalid_nip' } });
    expect(await callFn('lookup-company', { token: 'x', nip: NIP_TMOBILE })).toMatchObject({ status: 400, body: { error: 'bad_request' } });
    expect(await callFn('lookup-company', { token: 'e2e-nie-istnieje-123', nip: NIP_TMOBILE })).toMatchObject({ status: 404 });
    expect(await callFn('lookup-company', '{nie json')).toMatchObject({ status: 400 });

    const { data } = await admin.from('calc_sessions').select('company_id').eq('id', session.id).single();
    expect(data?.company_id).toBeNull(); // żadne z odrzuceń nie przypięło firmy
  });

  it('zarchiwizowana sesja: 404', async () => {
    const session = await newSession('lookup-arch');
    await admin.from('calc_sessions').update({ status: 'archived' }).eq('id', session.id);
    expect((await callFn('lookup-company', { token: session.token, nip: NIP_TMOBILE })).status).toBe(404);
  });

  it('poprawny NIP, którego nie ma w rejestrze: 422 i brak firmy w bazie', async (ctx) => {
    const session = await newSession('lookup-nf');
    const r = await callFn('lookup-company', { token: session.token, nip: '1000000006' });
    if (r.status === 200) return ctx.skip(); // GUS niedostępny — odpowiedź „sam NIP”
    expect(r).toMatchObject({ status: 422, body: { error: 'company_not_found' } });
    const { count } = await admin.from('companies').select('id', { count: 'exact', head: true }).eq('nip', '1000000006');
    expect(count).toBe(0);
  });

  it('limit zmian NIP: 10 na sesję, 11. odrzucona kodem 429 (firmy z pamięci podręcznej, bez zapytań do GUS)', async () => {
    const nips = randomValidNips(11);
    const { error } = await admin
      .from('companies')
      .insert(nips.map((nip, i) => ({ org_id: MITAX_ORG, nip, name: `FIRMA E2E ${i + 1}`, gus_status: 'found' })));
    expect(error).toBeNull();

    const session = await newSession('lookup-cap');
    const statuses: number[] = [];
    for (const nip of nips) statuses.push((await callFn('lookup-company', { token: session.token, nip })).status);

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
    const { data: events } = await admin.from('calc_events').select('id').eq('session_id', session.id).eq('field', 'company_id');
    expect(events).toHaveLength(10);
  });
});
