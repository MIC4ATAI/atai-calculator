import { describe, expect, it } from 'vitest';
import { formatAddress, formatNip, toCompanyView, type CompanyRow } from './companyView';

const row = (over: Partial<CompanyRow> = {}): CompanyRow => ({
  nip: '5261040567',
  regon: '011417295',
  name: 'T-MOBILE POLSKA SPÓŁKA AKCYJNA',
  street: 'ul. Test-Krucza',
  building_no: '12',
  unit_no: null,
  postal_code: '02-674',
  city: 'Warszawa',
  voivodeship: 'MAZOWIECKIE',
  gus_type: 'P',
  gus_status: 'found',
  fetched_at: '2026-11-11T12:00:00Z',
  ...over,
});

describe('formatNip', () => {
  it('formatuje 10 cyfr jako 526-104-05-67', () => {
    expect(formatNip('5261040567')).toBe('526-104-05-67');
  });
  it('inne wartości zostawia bez zmian', () => {
    expect(formatNip('123')).toBe('123');
    expect(formatNip('')).toBe('');
  });
});

describe('formatAddress', () => {
  it('ulica, numer i miejscowość', () => {
    expect(formatAddress(row())).toBe('ul. Test-Krucza 12, 02-674 Warszawa');
  });
  it('numer lokalu po ukośniku', () => {
    expect(formatAddress(row({ unit_no: '3' }))).toBe('ul. Test-Krucza 12/3, 02-674 Warszawa');
  });
  it('bez ulicy numer stoi przy miejscowości', () => {
    expect(formatAddress(row({ street: null, building_no: '15', city: 'Wola', postal_code: '12-345' }))).toBe('Wola 15, 12-345');
  });
  it('bez ulicy i numeru: kod i miejscowość', () => {
    expect(formatAddress(row({ street: null, building_no: null }))).toBe('02-674 Warszawa');
  });
  it('brak jakichkolwiek danych adresowych → null', () => {
    expect(formatAddress(row({ street: null, building_no: null, unit_no: null, postal_code: null, city: null }))).toBeNull();
  });
});

describe('toCompanyView — to, co widzi rozmówca', () => {
  it('nazwa, adres, sformatowany NIP i status', () => {
    expect(toCompanyView(row())).toEqual({
      nip: '526-104-05-67',
      name: 'T-MOBILE POLSKA SPÓŁKA AKCYJNA',
      address: 'ul. Test-Krucza 12, 02-674 Warszawa',
      gusStatus: 'found',
    });
  });

  it('GUS niedostępny: tylko NIP, bez nazwy i adresu', () => {
    const v = toCompanyView(row({ name: null, street: null, building_no: null, postal_code: null, city: null, gus_status: 'unavailable' }));
    expect(v).toEqual({ nip: '526-104-05-67', name: null, address: null, gusStatus: 'unavailable' });
  });

  it('nie ujawnia REGON-u, surowej odpowiedzi ani innych pól wewnętrznych', () => {
    const json = JSON.stringify(toCompanyView(row()));
    for (const hidden of ['011417295', 'regon', 'gus_raw', 'fetched_at', 'voivodeship', 'MAZOWIECKIE']) {
      expect(json).not.toContain(hidden);
    }
  });

  it('nieznany status traktuje jak „unavailable”', () => {
    expect(toCompanyView(row({ gus_status: 'coś' })).gusStatus).toBe('unavailable');
  });
});
