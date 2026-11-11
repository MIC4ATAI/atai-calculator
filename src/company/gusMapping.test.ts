import { describe, expect, it } from 'vitest';
import { mapGusRecord, toAttachPayload, unavailablePayload } from './gusMapping';

/** Prawdziwa odpowiedź bazy testowej GUS (bir1.search), zapisana ze spiku etapu 2. */
const TMOBILE = {
  Regon: '011417295',
  Nip: '5261040567',
  StatusNip: '',
  Nazwa: 'T-MOBILE POLSKA SPÓŁKA AKCYJNA',
  Wojewodztwo: 'MAZOWIECKIE',
  Powiat: 'm. st. Warszawa',
  Gmina: 'Mokotów',
  Miejscowosc: 'Warszawa',
  KodPocztowy: '02-674',
  Ulica: 'ul. Test-Krucza',
  NrNieruchomosci: '12',
  NrLokalu: '',
  Typ: 'P',
  SilosID: '6',
  DataZakonczeniaDzialalnosci: '',
  MiejscowoscPoczty: 'Warszawa',
};

describe('mapGusRecord — spółka z bazy testowej GUS', () => {
  const c = mapGusRecord(TMOBILE, '5261040567')!;

  it('mapuje nazwę, REGON, typ i adres', () => {
    expect(c).toMatchObject({
      nip: '5261040567',
      regon: '011417295',
      name: 'T-MOBILE POLSKA SPÓŁKA AKCYJNA',
      street: 'ul. Test-Krucza',
      buildingNo: '12',
      postalCode: '02-674',
      city: 'Warszawa',
      voivodeship: 'MAZOWIECKIE',
      gusType: 'P',
    });
  });

  it('puste pola GUS (np. numer lokalu) stają się null', () => {
    expect(c.unitNo).toBeNull();
  });
});

describe('mapGusRecord — inne rodzaje podmiotów', () => {
  it('działalność jednoosobowa (F) bez ulicy', () => {
    const c = mapGusRecord(
      { Nip: '5260250995', Regon: '123456785', Nazwa: 'KOWALSKI JAN BIURO RACHUNKOWE', Typ: 'F', Miejscowosc: 'Wola', KodPocztowy: '12-345', Ulica: '', NrNieruchomosci: '15', NrLokalu: '' },
      '5260250995',
    )!;
    expect(c.gusType).toBe('F');
    expect(c.street).toBeNull();
    expect(c.buildingNo).toBe('15');
  });

  it('kilka rekordów: bierze podmiot główny, nie jednostkę lokalną', () => {
    const c = mapGusRecord(
      [
        { Nip: '5261040567', Nazwa: 'JEDNOSTKA LOKALNA', Typ: 'LP' },
        { Nip: '5261040567', Nazwa: 'SPÓŁKA GŁÓWNA', Typ: 'P' },
      ],
      '5261040567',
    );
    expect(c?.name).toBe('SPÓŁKA GŁÓWNA');
  });

  it('odpowiedź bez pola Nip jest akceptowana (szukaliśmy po NIP-ie)', () => {
    expect(mapGusRecord({ Nazwa: 'X', Typ: 'P' }, '5261040567')?.name).toBe('X');
  });
});

describe('mapGusRecord — dane niezaufane', () => {
  it('NIP w odpowiedzi różny od szukanego → odrzucone', () => {
    expect(mapGusRecord({ ...TMOBILE, Nip: '5260250995' }, '5261040567')).toBeNull();
  });
  it('NIP w odpowiedzi z myślnikami i spacjami jest normalizowany przed porównaniem', () => {
    expect(mapGusRecord({ ...TMOBILE, Nip: '526-104-05-67' }, '5261040567')).not.toBeNull();
  });
  it('brak nazwy → odrzucone', () => {
    expect(mapGusRecord({ ...TMOBILE, Nazwa: '   ' }, '5261040567')).toBeNull();
    expect(mapGusRecord({ ...TMOBILE, Nazwa: undefined }, '5261040567')).toBeNull();
  });
  it('nie-obiekty i puste tablice → null', () => {
    for (const v of [null, undefined, 'tekst', 42, [], [null, 5]]) expect(mapGusRecord(v, '5261040567')).toBeNull();
  });
  it('porządkuje białe znaki i przycina do limitów tabeli', () => {
    const c = mapGusRecord({ ...TMOBILE, Nazwa: `  ${'A'.repeat(600)}  \n B `, Ulica: '  ul.   Test ' }, '5261040567')!;
    expect(c.name).toHaveLength(500);
    expect(c.street).toBe('ul. Test');
  });
  it('niepoprawny REGON i nieznany typ → null zamiast śmieci', () => {
    const c = mapGusRecord({ ...TMOBILE, Regon: 'abc', Typ: 'ZZ' }, '5261040567')!;
    expect(c.regon).toBeNull();
    expect(c.gusType).toBeNull();
  });
  it('REGON 14-cyfrowy jest poprawny', () => {
    expect(mapGusRecord({ ...TMOBILE, Regon: '01141729500012' }, '5261040567')?.regon).toBe('01141729500012');
  });
  it('wartości niebędące tekstem są ignorowane', () => {
    const c = mapGusRecord({ ...TMOBILE, Ulica: 123, Miejscowosc: { x: 1 } }, '5261040567')!;
    expect(c.street).toBeNull();
    expect(c.city).toBeNull();
  });
});

describe('ładunki dla RPC attach_company_to_session', () => {
  it('toAttachPayload: klucze jak kolumny bazy, status found, surowa odpowiedź zachowana', () => {
    const company = mapGusRecord(TMOBILE, '5261040567')!;
    const p = toAttachPayload(company, TMOBILE);
    expect(p).toMatchObject({
      nip: '5261040567',
      name: 'T-MOBILE POLSKA SPÓŁKA AKCYJNA',
      building_no: '12',
      unit_no: null,
      postal_code: '02-674',
      gus_type: 'P',
      gus_status: 'found',
    });
    expect(p.gus_raw).toEqual(TMOBILE);
  });

  it('zbyt duża surowa odpowiedź nie jest zapisywana', () => {
    const company = mapGusRecord(TMOBILE, '5261040567')!;
    expect(toAttachPayload(company, { ...TMOBILE, Smieci: 'x'.repeat(20_000) }).gus_raw).toBeNull();
  });

  it('unavailablePayload: sam NIP i status, bez żadnych danych do nadpisania', () => {
    expect(unavailablePayload('5261040567')).toEqual({ nip: '5261040567', gus_status: 'unavailable' });
  });
});
