/**
 * E2E: CTA „Przyślij mi kalkulację jako Excel oraz link do sesji” (Edge Function `request-calculation`).
 * Prawdziwy przebieg: polityka CTA → zamrożenie stanu i lead w bazie → Excel i mail → dostawa do lokalnego Mailpita,
 * z odczytem wiadomości i załącznika tak, jak zrobiłby to odbiorca.
 *
 * Scenariusze w `describe` są kolejnymi krokami jednej sesji (stan przechodzi z testu do testu). Dwa kroki czekają
 * na koniec 10-sekundowego okna ochrony przed podwójnym kliknięciem.
 *
 * Nieudaną wysyłkę (awaria dostawcy poczty) sprawdzamy testami jednostkowymi adaptera i ręcznie — wymaga ona
 * restartu funkcji z innym środowiskiem, czego ten zestaw nie robi.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DUPLICATE_WINDOW_MS } from '../cta/deliverySummary';
import { MAX_SENDS } from '../cta/ctaPolicy';
import {
  admin,
  attachmentBytes,
  callFn,
  deleteMailsTo,
  fillExample,
  latestMail,
  mailCount,
  newSession,
  readWorkbook,
  reveal,
  sleep,
  unique,
  type TestSession,
} from './helpers';

const NIP = '5261040567';
const sentEmails: string[] = [];

/** Adres rozmówcy unikalny dla przebiegu (pasuje do reguł walidacji; domena .test nigdzie nie dostarcza). */
function newEmail(): string {
  const email = `rozmowca-${unique()}@e2e.test`;
  sentEmails.push(email);
  return email;
}

async function sessionWithCompany(label: string): Promise<TestSession> {
  const session = await newSession(label);
  const r = await callFn('lookup-company', { token: session.token, nip: NIP });
  expect(r.status).toBe(200); // także „GUS niedostępny” (sam NIP) wystarcza do CTA
  return session;
}

const countRows = async (table: 'leads' | 'calc_snapshots', sessionId: string): Promise<number> => {
  const { count, error } = await admin.from(table).select('id', { count: 'exact', head: true }).eq('session_id', sessionId);
  if (error) throw error;
  return count ?? 0;
};

afterAll(async () => {
  await deleteMailsTo(sentEmails);
});

describe('strażnicy CTA: nic nie jest zamrażane ani wysyłane, gdy sesja nie jest gotowa', () => {
  it('wynik nie został odsłonięty → 409 not_revealed', async () => {
    const session = await sessionWithCompany('cta-guard');
    await fillExample(session.token);
    const r = await callFn('request-calculation', { token: session.token, email: newEmail() });
    expect(r).toMatchObject({ status: 409, body: { error: 'not_revealed' } });
    expect(await countRows('leads', session.id)).toBe(0);
    expect(await countRows('calc_snapshots', session.id)).toBe(0);
  });

  it('brak firmy (NIP) → 409 no_company', async () => {
    const session = await newSession('cta-nocompany');
    await fillExample(session.token);
    await reveal(session.id);
    expect(await callFn('request-calculation', { token: session.token, email: newEmail() })).toMatchObject({
      status: 409,
      body: { error: 'no_company' },
    });
    expect(await countRows('calc_snapshots', session.id)).toBe(0);
  });

  it('niekompletne dane → 409 incomplete_data', async () => {
    const session = await sessionWithCompany('cta-incomplete');
    await reveal(session.id);
    expect(await callFn('request-calculation', { token: session.token, email: newEmail() })).toMatchObject({
      status: 409,
      body: { error: 'incomplete_data' },
    });
    expect(await countRows('calc_snapshots', session.id)).toBe(0);
  });

  it('niepoprawny adres i próba dopisania odbiorców → 400 invalid_email, bez leada i snapshotu', async () => {
    const session = await sessionWithCompany('cta-email');
    await fillExample(session.token);
    await reveal(session.id);
    for (const email of ['nie-email', 'a@e2e.test,b@e2e.test', 'a@e2e.test\nBcc: x@e2e.test', '', null]) {
      const r = await callFn('request-calculation', { token: session.token, email });
      expect(r, JSON.stringify(email)).toMatchObject({ status: 400, body: { error: 'invalid_email' } });
    }
    expect(await countRows('leads', session.id)).toBe(0);
    expect(await countRows('calc_snapshots', session.id)).toBe(0);
  });

  it('zły token → 400, nieznana sesja → 404', async () => {
    expect((await callFn('request-calculation', { token: 'x', email: 'a@e2e.test' })).status).toBe(400);
    expect((await callFn('request-calculation', { token: 'e2e-nie-istnieje-123', email: 'a@e2e.test' })).status).toBe(404);
  });
});

describe('pełny przebieg CTA jednej sesji', () => {
  const email = newEmail();
  let session: TestSession;

  beforeAll(async () => {
    session = await sessionWithCompany('cta-flow');
    await fillExample(session.token);
    await reveal(session.id, 10); // miks wybrany suwakiem: 10 KH
  });

  it('pierwsza wysyłka: lead, jeden snapshot, dostawa, status „udostępniona”, użycie', async () => {
    const r = await callFn('request-calculation', { token: session.token, email: ` ${email.toUpperCase()} ` });
    expect(r.status).toBe(200);
    expect(r.body.cta).toMatchObject({ available: true, sentCount: 1, remaining: MAX_SENDS - 1 });
    expect(r.body.cta.emailMasked).toBe(`r***@${email.split('@')[1]}`);

    const { data: leads } = await admin.from('leads').select('email, id').eq('session_id', session.id);
    expect(leads).toHaveLength(1);
    expect(leads![0]!.email).toBe(email); // znormalizowany: małe litery, bez spacji

    const { data: snapshot } = await admin.from('calc_snapshots').select('inputs, mix, calc_version').eq('session_id', session.id).single();
    expect(snapshot).toMatchObject({ inputs: { kh: 100 }, mix: { kh: 10, kpir: 20 } });
    expect(snapshot!.calc_version).toMatch(/^\d+\.\d+\.\d+$/);

    const { data: deliveries } = await admin.from('lead_deliveries').select('status, provider').eq('lead_id', leads![0]!.id);
    expect(deliveries).toEqual([{ status: 'sent', provider: 'mailpit' }]);

    const { data: row } = await admin.from('calc_sessions').select('status').eq('id', session.id).single();
    expect(row?.status).toBe('shared');
    const { count } = await admin
      .from('usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', session.id)
      .eq('event_type', 'calculation_sent');
    expect(count).toBe(1);
  });

  it('mail w marce organizacji: nadawca, Reply-To do konsultantki, temat, wynik i link do sesji', async () => {
    const mail = await latestMail(email);
    expect(mail.From).toMatchObject({ Name: 'MITAX Consulting', Address: 'kalkulator@mitax.test' });
    expect(mail.To.map((a) => a.Address)).toEqual([email]);
    expect(mail.ReplyTo?.map((a) => a.Address)).toEqual(['ola@mitax.test']);
    expect(mail.Subject).toBe('Twoja kalkulacja z rozmowy – MITAX Consulting sp. z o.o.');
    expect(mail.Text).toContain('Wynik z rozmowy: 121 h miesięcznie → +20 klientów KH');
    expect(mail.Text).toContain(`/s/${session.token}`);
    expect(mail.Text).toContain('Ola Konsultant');
    expect(mail.HTML).toContain('lang="pl"');
    // zaproszenie na landing page jest domyślnie wyłączone (flaga MAIL_LANDING_INVITATION): MITAX ma landingUrl, ale mail go nie niesie
    expect(mail.Text).not.toContain('landing.mitax.test');
    expect(mail.HTML).not.toContain('landing.mitax.test');
  });

  it('załącznik .xlsx otwiera się i zawiera stan z rozmowy (dwie zakładki, miks z suwaka)', async () => {
    const mail = await latestMail(email);
    expect(mail.Attachments).toHaveLength(1);
    expect(mail.Attachments[0]!.FileName).toMatch(/^kalkulacja-\d{4}-\d{2}-\d{2}\.xlsx$/);

    const book = await readWorkbook(await attachmentBytes(mail));
    expect(book.sheets).toHaveLength(2);
    expect(book.sheets[0]).toMatch(/^Kalkulacja z rozmowy \(\d{2}\.\d{2}\.\d{2}\)$/);
    expect(book.sheets[1]).toBe('Twoja symulacja');
    expect(book).toMatchObject({ kh: 100, mixKh: 10 });
    expect(book.godziny).toBeCloseTo(120.96, 2);
    // „Twoja symulacja” ma działające formuły z zapisanymi wynikami (podgląd na telefonie nie pokaże pustych komórek)
    expect(book.formulas.total).toBeGreaterThan(10);
    expect(book.formulas.withCachedResult).toBe(book.formulas.total);
    expect(String(book.firma)).toContain('NIP 526-104-05-67');
  });

  it('podwójne kliknięcie: natychmiastowa ponowna prośba niczego nie wysyła', async () => {
    const before = await mailCount(email);
    const r = await callFn('request-calculation', { token: session.token, email });
    expect(r).toMatchObject({ status: 200, body: { duplicate: true } });
    await sleep(500);
    expect(await mailCount(email)).toBe(before);
  });

  it('ZAMROŻENIE: zmiany rozmówcy po wysyłce nie zmieniają ponownie wysłanego pliku', async () => {
    await callFn('guest-session', { action: 'patch', token: session.token, patch: { kh: 999, przychod: 1 } });
    await sleep(DUPLICATE_WINDOW_MS + 1_000); // koniec okna ochrony przed podwójnym kliknięciem

    const before = await mailCount(email);
    const r = await callFn('request-calculation', { token: session.token }); // bez adresu = ponowna wysyłka na zablokowany
    expect(r.status).toBe(200);
    expect(r.body.cta).toMatchObject({ sentCount: 2, remaining: MAX_SENDS - 2 });
    await sleep(500);
    expect(await mailCount(email)).toBe(before + 1);

    const book = await readWorkbook(await attachmentBytes(await latestMail(email)));
    expect(book).toMatchObject({ kh: 100, mixKh: 10 }); // stan z rozmowy, nie z późniejszych zmian
    expect(book.godziny).toBeCloseTo(120.96, 2);

    const { data: live } = await admin.from('calc_sessions').select('inputs').eq('id', session.id).single();
    expect((live!.inputs as { kh: number }).kh).toBe(999); // żywa sesja się zmieniła, snapshot nie
    expect(await countRows('calc_snapshots', session.id)).toBe(1);
  });

  it('blokady po udanej wysyłce: inny adres i zmiana NIP odrzucone, ten sam NIP przechodzi, bez nowego leada', async () => {
    expect(await callFn('request-calculation', { token: session.token, email: newEmail() })).toMatchObject({
      status: 409,
      body: { error: 'email_locked' },
    });
    expect(await callFn('lookup-company', { token: session.token, nip: '5260250995' })).toMatchObject({
      status: 409,
      body: { error: 'nip_locked' },
    });
    expect((await callFn('lookup-company', { token: session.token, nip: NIP })).status).toBe(200);
    expect(await countRows('leads', session.id)).toBe(1);
  });

  it(`limit: ${MAX_SENDS}. wysyłka przechodzi, kolejna dostaje 429 — a SQL egzekwuje ten sam limit niezależnie od warstwy TS`, async () => {
    await sleep(DUPLICATE_WINDOW_MS + 1_000);
    const third = await callFn('request-calculation', { token: session.token });
    expect(third.status).toBe(200);
    expect(third.body.cta).toMatchObject({ available: false, blockedReason: 'limit_reached', sentCount: MAX_SENDS, remaining: 0 });

    const fourth = await callFn('request-calculation', { token: session.token });
    expect(fourth).toMatchObject({ status: 429, body: { error: 'limit_reached' } });

    // Parytet stałej MAX_SENDS (TS) z limitem w RPC (SQL): wywołanie RPC wprost, z pominięciem warstwy TS.
    const { error } = await admin.rpc('prepare_calculation_delivery', {
      p_token: session.token,
      p_email: email,
      p_calc: {},
      p_expected_updated_at: new Date().toISOString(),
    });
    expect(error?.code).toBe('AT003');

    const { count } = await admin
      .from('lead_deliveries')
      .select('id, leads!inner(session_id)', { count: 'exact', head: true })
      .eq('leads.session_id', session.id)
      .eq('status', 'sent');
    expect(count).toBe(MAX_SENDS);
  });

  it('widok rozmówcy po wysyłkach: zamaskowany adres, zablokowany NIP, żadnego pełnego adresu', async () => {
    const r = await callFn('guest-session', { action: 'get', token: session.token });
    expect(r.body.view.cta).toMatchObject({ available: false, blockedReason: 'limit_reached', sentCount: MAX_SENDS });
    expect(r.body.view.cta.emailMasked).toBe(`r***@${email.split('@')[1]}`);
    expect(r.body.view.nipLocked).toBe(true);
    const json = JSON.stringify(r.body);
    expect(json).not.toContain(email);
    expect(json).not.toContain('lockedEmail');
  });
});
