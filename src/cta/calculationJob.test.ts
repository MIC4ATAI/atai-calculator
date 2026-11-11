import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../calc/calculator';
import { PRZYKLAD_INPUTS } from '../excel/testFixtures';
import { parseCalculationRequest } from './calculationRequest';
import {
  buildCalcPayload,
  buildDeliveryMessage,
  ctaStateFrom,
  DUPLICATE_WINDOW_MS,
  isDuplicateSend,
  parseSnapshot,
  SnapshotError,
  summarizeDeliveries,
  toEmailInput,
  toWorkbookInput,
  type ConsultantInfo,
  type DeliveryContext,
  type SnapshotRow,
} from './calculationJob';

const TOKEN = '1181ff2144831cd0ae0a4a66cb38a3ad5c821fb4d05ee355';

const org = {
  name: 'MITAX Consulting sp. z o.o.',
  brand: {
    senderName: 'MITAX Consulting',
    senderEmail: 'kalkulator@mitax.test',
    primaryColor: '#336699',
    landingUrl: 'https://landing.mitax.test/kalkulator',
  },
};
const company = { name: 'T-MOBILE POLSKA SPÓŁKA AKCYJNA', nip: '5261040567' };
const consultant: ConsultantInfo = {
  name: 'Ola Konsultant',
  phone: '+48 600 100 300',
  signature: 'Ola Konsultant\nMITAX Consulting sp. z o.o.',
  email: 'ola@mitax.test',
};

/** Snapshot tak, jak zapisze go serwer: dane i założenia z sesji, wynik i miks z buildCalcPayload (po round-tripie JSON). */
function makeSnapshot(over: Partial<SnapshotRow> = {}, mixKh: number | null = null): SnapshotRow {
  const payload = buildCalcPayload({ inputs: PRZYKLAD_INPUTS, params: {}, mix_kh: mixKh })!;
  return JSON.parse(
    JSON.stringify({
      inputs: PRZYKLAD_INPUTS,
      params: {},
      result: payload.result,
      mix: payload.mix,
      calc_version: payload.calc_version,
      created_at: '2026-11-11T12:00:00Z',
      ...over,
    }),
  );
}

describe('parseCalculationRequest', () => {
  it('token i adres', () => {
    expect(parseCalculationRequest({ token: TOKEN, email: 'a@b.pl' })).toEqual({ ok: true, token: TOKEN, email: 'a@b.pl' });
  });
  it('brak adresu = prośba o ponowną wysyłkę na zablokowany adres', () => {
    expect(parseCalculationRequest({ token: TOKEN })).toEqual({ ok: true, token: TOKEN, email: null });
    expect(parseCalculationRequest({ token: TOKEN, email: null })).toEqual({ ok: true, token: TOKEN, email: null });
  });
  it('zły kształt: bad_request', () => {
    for (const body of [null, undefined, 'x', [], {}, { token: 'x' }, { token: TOKEN, email: 5 }, { token: TOKEN, email: 'a'.repeat(400) }]) {
      expect(parseCalculationRequest(body)).toEqual({ ok: false, error: 'bad_request' });
    }
  });
  it('niepoprawny format adresu NIE jest tu odrzucany (robi to polityka CTA: invalid_email)', () => {
    expect(parseCalculationRequest({ token: TOKEN, email: 'nie-email' }).ok).toBe(true);
  });
});

describe('buildCalcPayload', () => {
  it('przykład kontrolny: wynik i miks domyślnie na maksimum KH', () => {
    const p = buildCalcPayload({ inputs: PRZYKLAD_INPUTS, params: {}, mix_kh: null })!;
    expect(p.result.godzinyDoOdzyskania).toBeCloseTo(120.96, 2);
    expect(p.mix).toMatchObject({ kh: 20, kpir: 0 });
    expect(p.calc_version).toBe(p.result.calcVersion);
  });
  it('miks z suwaka rozmówcy; wartości spoza zakresu są przycinane', () => {
    expect(buildCalcPayload({ inputs: PRZYKLAD_INPUTS, params: {}, mix_kh: 10 })!.mix).toMatchObject({ kh: 10, kpir: 20 });
    expect(buildCalcPayload({ inputs: PRZYKLAD_INPUTS, params: {}, mix_kh: 999 })!.mix.kh).toBe(20);
  });
  it('używa założeń sesji', () => {
    const p = buildCalcPayload({ inputs: PRZYKLAD_INPUTS, params: { celKorzysci: 15_000 }, mix_kh: null })!;
    expect(p.result.godzinyDoOdzyskania).toBeCloseTo(120.96 * 1.5, 2);
  });
  it('dane niekompletne lub niepoprawne → null (nie zamrażamy bzdur)', () => {
    expect(buildCalcPayload({ inputs: { kh: 100 }, params: {}, mix_kh: null })).toBeNull();
    expect(buildCalcPayload({ inputs: { ...PRZYKLAD_INPUTS, ef: 150 }, params: {}, mix_kh: null })).toBeNull();
    expect(buildCalcPayload({ inputs: null, params: null, mix_kh: null })).toBeNull();
  });
  it('wynik przechodzi round-trip JSON (tak trafia do bazy) i wraca jako poprawny snapshot', () => {
    expect(() => parseSnapshot(makeSnapshot())).not.toThrow();
  });
});

describe('parseSnapshot', () => {
  it('odtwarza dane, założenia, wynik, miks, wersję i datę', () => {
    const s = parseSnapshot(makeSnapshot({}, 10));
    expect(s.inputs).toEqual(PRZYKLAD_INPUTS);
    expect(s.params).toEqual(DEFAULT_PARAMS);
    expect(s.result.godzinyDoOdzyskania).toBeCloseTo(120.96, 2);
    expect(s.mix).toMatchObject({ kh: 10, kpir: 20 });
    expect(s.calcVersion).toBe('1.1.0');
    expect(s.createdAt.toISOString()).toBe('2026-11-11T12:00:00.000Z');
  });

  it('starszy snapshot bez przychodNaGodzine nie psuje wysyłki (traktowane jak null)', () => {
    const row = makeSnapshot();
    delete (row.result as Record<string, unknown>).przychodNaGodzine;
    expect(parseSnapshot(row).result.przychodNaGodzine).toBeNull();
  });

  it.each<[string, Partial<SnapshotRow>]>([
    ['wynik pusty', { result: {} }],
    ['wynik nie-obiekt', { result: 'x' }],
    ['wynik z tekstem zamiast liczby', { result: { ...(makeSnapshot().result as object), godzinyDoOdzyskania: 'dużo' } }],
    ['cena nie-liczbowa', { result: { ...(makeSnapshot().result as object), cenaKh: 'drogo' } }],
    ['miks pusty', { mix: {} }],
    ['miks nie-obiekt', { mix: null }],
    ['zła data', { created_at: 'nie-data' }],
    ['brak wersji logiki', { calc_version: '' }],
  ])('uszkodzony snapshot (%s) → SnapshotError', (_n, over) => {
    expect(() => parseSnapshot(makeSnapshot(over))).toThrow(SnapshotError);
  });
});

describe('Excel i mail powstają ZE SNAPSHOTU, nie z żywej sesji', () => {
  const ctx = (over: Partial<DeliveryContext> = {}): DeliveryContext => ({
    snapshot: makeSnapshot(),
    org,
    company,
    consultant,
    token: TOKEN,
    appBaseUrl: 'https://atai.mitax.pl',
    recipient: 'rozmowca@firma.pl',
    defaultSender: { email: 'domyslny@platforma.test', name: 'Kalkulator' },
    ...over,
  });

  it('wiadomość: nadawca z marki, odbiorca, Reply-To do konsultanta, temat, załącznik .xlsx', async () => {
    const msg = await buildDeliveryMessage(ctx());
    expect(msg.from).toEqual({ email: 'kalkulator@mitax.test', name: 'MITAX Consulting' });
    expect(msg.to).toEqual({ email: 'rozmowca@firma.pl' });
    expect(msg.replyTo).toEqual({ email: 'ola@mitax.test', name: 'Ola Konsultant' });
    expect(msg.subject).toBe('Twoja kalkulacja z rozmowy – MITAX Consulting sp. z o.o.');
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0]!.filename).toBe('kalkulacja-2026-11-11.xlsx');
    expect(String.fromCharCode(msg.attachments[0]!.content[0]!, msg.attachments[0]!.content[1]!)).toBe('PK');
  });

  it('link do sesji z tokenem w treści maila (HTML i tekst)', async () => {
    const msg = await buildDeliveryMessage(ctx());
    const url = `https://atai.mitax.pl/s/${TOKEN}`;
    expect(msg.html).toContain(`href="${url}"`);
    expect(msg.text).toContain(url);
  });

  it('wartości z SNAPSHOTU trafiają do pliku i maila — nawet gdy wyglądają inaczej niż wynik żywej sesji', async () => {
    const row = makeSnapshot();
    (row.result as Record<string, number>).godzinyDoOdzyskania = 777; // „stan z rozmowy”, inny niż policzyłaby dziś sesja
    const msg = await buildDeliveryMessage(ctx({ snapshot: row }));

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(msg.attachments[0]!.content as never);
    const sheet1 = wb.worksheets[0]!;
    let found: unknown;
    sheet1.eachRow((r) => {
      if (r.getCell(1).value === 'Godziny do odzyskania / mies.') found = r.getCell(2).value;
    });
    expect(found).toBe(777);
    expect(msg.html).toContain('777 h miesięcznie');
    expect(msg.text).toContain('777 h miesięcznie');
  });

  it('plik: dwie zakładki, kolor marki z organizacji, firma i NIP w nagłówku', async () => {
    const msg = await buildDeliveryMessage(ctx());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(msg.attachments[0]!.content as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Kalkulacja z rozmowy (11.11.26)', 'Twoja symulacja']);
    expect(wb.worksheets[0]!.getCell('A3').value).toBe('Firma: T-MOBILE POLSKA SPÓŁKA AKCYJNA · NIP 526-104-05-67');
    expect((wb.worksheets[0]!.getCell('A6').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF336699');
  });

  it('bez adresu konsultanta nie ma Reply-To; adres odbiorcy jest normalizowany', async () => {
    const msg = await buildDeliveryMessage(ctx({ consultant: { ...consultant, email: null }, recipient: ' Rozmowca@Firma.PL ' }));
    expect('replyTo' in msg).toBe(false);
    expect(msg.to.email).toBe('rozmowca@firma.pl');
  });

  it('marka niepoprawna lub pusta: nadawca awaryjny, domyślny kolor, wysyłka nie pada', async () => {
    const msg = await buildDeliveryMessage(ctx({ org: { name: 'AT AI Solutions', brand: 'to nie jest obiekt' } }));
    expect(msg.from).toEqual({ email: 'domyslny@platforma.test', name: 'AT AI Solutions' });
    expect(msg.subject).toContain('AT AI Solutions');
  });

  it('uszkodzony snapshot nie kończy się wysłaniem śmieci', async () => {
    await expect(buildDeliveryMessage(ctx({ snapshot: makeSnapshot({ result: {} }) }))).rejects.toThrow(SnapshotError);
  });

  it('niepoprawny adres odbiorcy → błąd, nigdy wysyłka „na zgadywankę”', async () => {
    await expect(buildDeliveryMessage(ctx({ recipient: 'a@b.pl,c@d.pl' }))).rejects.toThrow(/odbiorcy/);
  });

  it('toWorkbookInput i toEmailInput mapują dane jednego snapshotu spójnie', () => {
    const s = parseSnapshot(makeSnapshot({}, 10));
    const w = toWorkbookInput(s, org, company, consultant);
    expect(w).toMatchObject({ organizationName: org.name, accentColor: '#336699', consultantName: 'Ola Konsultant', calcVersion: '1.1.0' });
    expect(w.mix.kh).toBe(10);
    const e = toEmailInput(s, org, company, consultant, 'https://x.pl/s/a');
    expect(e.summary).toEqual({ godzinyDoOdzyskania: s.result.godzinyDoOdzyskania, maksNowychKh: 20 });
    expect(e.brand.landingUrl).toBe('https://landing.mitax.test/kalkulator');
  });
});

describe('summarizeDeliveries', () => {
  const lead = (id: string, email: string) => ({ id, email });
  const delivery = (id: number, lead_id: string, status: string, created_at = '2026-11-11T12:00:00Z') => ({ id, lead_id, status, created_at });

  it('bez leadów i dostaw: nic', () => {
    expect(summarizeDeliveries([], [])).toEqual({ hasLead: false, sentCount: 0, lockedEmail: null, lastSentAt: null });
  });
  it('lead bez udanej dostawy: NIP zablokowany, e-mail jeszcze nie', () => {
    expect(summarizeDeliveries([lead('a', 'x@firma.pl')], [delivery(1, 'a', 'failed')])).toEqual({
      hasLead: true,
      sentCount: 0,
      lockedEmail: null,
      lastSentAt: null,
    });
  });
  it('adres blokowany po pierwszej UDANEJ dostawie; liczone tylko udane', () => {
    const r = summarizeDeliveries(
      [lead('a', 'x@firma.pl')],
      [delivery(1, 'a', 'failed'), delivery(2, 'a', 'sent', '2026-11-11T12:01:00Z'), delivery(3, 'a', 'sent', '2026-11-11T12:05:00Z')],
    );
    expect(r).toEqual({ hasLead: true, sentCount: 2, lockedEmail: 'x@firma.pl', lastSentAt: '2026-11-11T12:05:00Z' });
  });
  it('literówka poprawiona nowym leadem: zablokowany jest adres z pierwszej UDANEJ dostawy', () => {
    const r = summarizeDeliveries(
      [lead('a', 'literowka@firma.pl'), lead('b', 'poprawny@firma.pl')],
      [delivery(1, 'a', 'failed'), delivery(2, 'b', 'sent')],
    );
    expect(r.lockedEmail).toBe('poprawny@firma.pl');
    expect(r.sentCount).toBe(1);
  });
  it('kolejność dostaw nie zależy od kolejności wierszy w odpowiedzi', () => {
    const r = summarizeDeliveries([lead('a', 'a@f.pl'), lead('b', 'b@f.pl')], [delivery(7, 'b', 'sent'), delivery(3, 'a', 'sent')]);
    expect(r.lockedEmail).toBe('a@f.pl');
  });
  it('dostawy osierocone (lead spoza sesji) są ignorowane', () => {
    expect(summarizeDeliveries([lead('a', 'a@f.pl')], [delivery(1, 'obcy', 'sent')]).sentCount).toBe(0);
  });
});

describe('ctaStateFrom i isDuplicateSend', () => {
  const delivery = { hasLead: false, sentCount: 0, lockedEmail: null, lastSentAt: null };

  it('stan z sesji i dostaw; dataComplete z poprawności danych', () => {
    expect(ctaStateFrom({ revealed: true, inputs: PRZYKLAD_INPUTS, params: {}, hasCompany: true, delivery })).toEqual({
      revealed: true,
      hasCompany: true,
      dataComplete: true,
      sentCount: 0,
      lockedEmail: null,
    });
    expect(ctaStateFrom({ revealed: true, inputs: { kh: 1 }, params: {}, hasCompany: true, delivery }).dataComplete).toBe(false);
    expect(ctaStateFrom({ revealed: true, inputs: PRZYKLAD_INPUTS, params: {}, hasCompany: true, delivery: { ...delivery, sentCount: 2, lockedEmail: 'a@b.pl' } })).toMatchObject({
      sentCount: 2,
      lockedEmail: 'a@b.pl',
    });
  });

  it('podwójne kliknięcie: prośba tuż po udanej wysyłce nie wysyła drugiego maila', () => {
    const now = Date.parse('2026-11-11T12:00:30Z');
    expect(isDuplicateSend('2026-11-11T12:00:25Z', now)).toBe(true);
    expect(isDuplicateSend('2026-11-11T12:00:20Z', now)).toBe(false); // dokładnie na granicy okna
    expect(isDuplicateSend('2026-11-11T11:00:00Z', now)).toBe(false);
    expect(isDuplicateSend(null, now)).toBe(false);
    expect(isDuplicateSend('nie-data', now)).toBe(false);
    expect(isDuplicateSend('2026-11-11T12:01:00Z', now)).toBe(false); // data z przyszłości — nie ufamy
    expect(DUPLICATE_WINDOW_MS).toBe(10_000);
  });
});
