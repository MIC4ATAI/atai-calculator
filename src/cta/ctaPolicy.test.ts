import { describe, expect, it } from 'vitest';
import {
  buildCtaView,
  CTA_MESSAGES,
  ctaRejectionStatus,
  decideCta,
  MAX_SENDS,
  type CtaRejection,
  type CtaState,
} from './ctaPolicy';

const ready = (over: Partial<CtaState> = {}): CtaState => ({
  revealed: true,
  hasCompany: true,
  dataComplete: true,
  sentCount: 0,
  lockedEmail: null,
  ...over,
});

const EMAIL = 'rozmowca@firma.pl';

describe('decideCta — tabela decyzji', () => {
  it.each<[string, CtaState, unknown, string]>([
    ['pierwsza wysyłka', ready(), EMAIL, 'send:first'],
    ['pierwsza wysyłka, adres z dużymi literami i spacjami', ready(), '  Rozmowca@Firma.PL ', 'send:first'],
    ['ponowna wysyłka na ten sam adres', ready({ sentCount: 1, lockedEmail: EMAIL }), EMAIL, 'send:resend'],
    ['druga ponowna wysyłka (łącznie 3)', ready({ sentCount: 2, lockedEmail: EMAIL }), EMAIL, 'send:resend'],
    ['ponowna wysyłka, adres zapisany inaczej (wielkość liter)', ready({ sentCount: 1, lockedEmail: EMAIL }), 'ROZMOWCA@firma.pl', 'send:resend'],
    ['wynik nie odsłonięty', ready({ revealed: false }), EMAIL, 'reject:not_revealed'],
    ['brak firmy (NIP)', ready({ hasCompany: false }), EMAIL, 'reject:no_company'],
    ['niekompletne dane', ready({ dataComplete: false }), EMAIL, 'reject:incomplete_data'],
    ['limit wysyłek', ready({ sentCount: MAX_SENDS, lockedEmail: EMAIL }), EMAIL, 'reject:limit_reached'],
    ['limit przekroczony', ready({ sentCount: MAX_SENDS + 4, lockedEmail: EMAIL }), EMAIL, 'reject:limit_reached'],
    ['niepoprawny adres', ready(), 'nie-email', 'reject:invalid_email'],
    ['pusty adres', ready(), '', 'reject:invalid_email'],
    ['brak adresu', ready(), undefined, 'reject:invalid_email'],
    ['wstrzyknięcie odbiorcy', ready(), 'a@firma.pl,b@firma.pl', 'reject:invalid_email'],
    ['inny adres po udanej wysyłce', ready({ sentCount: 1, lockedEmail: EMAIL }), 'inny@firma.pl', 'reject:email_locked'],
  ])('%s → %s', (_name, state, raw, expected) => {
    const d = decideCta(state, raw);
    const label = d.ok ? `send:${d.kind}` : `reject:${d.reason}`;
    expect(label).toBe(expected);
  });

  it('przy poprawnej decyzji zwraca znormalizowany adres', () => {
    expect(decideCta(ready(), '  Rozmowca@Firma.PL ')).toEqual({ ok: true, kind: 'first', email: EMAIL });
  });

  it('przed udaną wysyłką można poprawić literówkę w adresie (brak blokady, dopóki sentCount = 0)', () => {
    expect(decideCta(ready({ sentCount: 0, lockedEmail: null }), 'poprawny@firma.pl')).toMatchObject({ ok: true, kind: 'first' });
  });

  it('kolejność sprawdzeń: niegotowa sesja wygrywa z niepoprawnym adresem i limitem', () => {
    expect(decideCta(ready({ revealed: false, sentCount: MAX_SENDS }), 'zly')).toEqual({ ok: false, reason: 'not_revealed' });
    expect(decideCta(ready({ sentCount: MAX_SENDS, lockedEmail: EMAIL }), 'zly')).toEqual({ ok: false, reason: 'limit_reached' });
  });
});

describe('komunikaty i kody HTTP', () => {
  const reasons: CtaRejection[] = ['not_revealed', 'no_company', 'incomplete_data', 'limit_reached', 'invalid_email', 'email_locked'];

  it('każdy powód odrzucenia ma komunikat po polsku, bez żargonu technicznego', () => {
    for (const reason of reasons) {
      expect(CTA_MESSAGES[reason].length).toBeGreaterThan(10);
      expect(CTA_MESSAGES[reason]).not.toMatch(/RPC|AT00|SQL|token|supabase|snapshot/i);
    }
  });

  it('niepoprawny adres = 400, limit = 429, pozostałe = 409', () => {
    expect(ctaRejectionStatus('invalid_email')).toBe(400);
    expect(ctaRejectionStatus('limit_reached')).toBe(429);
    for (const r of ['not_revealed', 'no_company', 'incomplete_data', 'email_locked'] as const) {
      expect(ctaRejectionStatus(r)).toBe(409);
    }
  });

  it('komunikat o zablokowanym adresie nie ujawnia pełnego adresu', () => {
    expect(CTA_MESSAGES.email_locked).not.toContain('@');
  });
});

describe('buildCtaView — stan CTA widoczny dla rozmówcy', () => {
  it('wynik odsłonięty, nic nie wysłano: dostępne, 3 wysyłki do wykorzystania, bez adresu', () => {
    expect(buildCtaView(ready())).toEqual({ available: true, blockedReason: null, sentCount: 0, remaining: 3, emailMasked: null });
  });

  it('po pierwszej wysyłce: nadal dostępne (ponowna wysyłka), zamaskowany adres', () => {
    expect(buildCtaView(ready({ sentCount: 1, lockedEmail: 'jan.kowalski@firma.pl' }))).toEqual({
      available: true,
      blockedReason: null,
      sentCount: 1,
      remaining: 2,
      emailMasked: 'j***@firma.pl',
    });
  });

  it('po wyczerpaniu limitu: niedostępne z powodem, adres dalej zamaskowany', () => {
    const v = buildCtaView(ready({ sentCount: 3, lockedEmail: EMAIL }));
    expect(v).toMatchObject({ available: false, blockedReason: 'limit_reached', remaining: 0, emailMasked: 'r***@firma.pl' });
  });

  it('powody niegotowości w kolejności: odsłonięcie → firma → dane', () => {
    expect(buildCtaView(ready({ revealed: false, hasCompany: false })).blockedReason).toBe('not_revealed');
    expect(buildCtaView(ready({ hasCompany: false, dataComplete: false })).blockedReason).toBe('no_company');
    expect(buildCtaView(ready({ dataComplete: false })).blockedReason).toBe('incomplete_data');
  });

  it('nigdy nie ujawnia pełnego adresu ani liczby ponad limit', () => {
    const v = buildCtaView(ready({ sentCount: 9, lockedEmail: 'tajny.adres@firma.pl' }));
    expect(JSON.stringify(v)).not.toContain('tajny.adres');
    expect(v.remaining).toBe(0);
  });

  it('widok zgadza się z decyzją: available ⇔ decideCta nie odrzuca z powodu stanu sesji', () => {
    const states: CtaState[] = [
      ready(),
      ready({ revealed: false }),
      ready({ hasCompany: false }),
      ready({ dataComplete: false }),
      ready({ sentCount: 1, lockedEmail: EMAIL }),
      ready({ sentCount: 3, lockedEmail: EMAIL }),
    ];
    for (const state of states) {
      const view = buildCtaView(state);
      const d = decideCta(state, state.lockedEmail ?? EMAIL);
      expect(d.ok, JSON.stringify(state)).toBe(view.available);
      if (!d.ok) expect(d.reason).toBe(view.blockedReason);
    }
  });
});
