import { describe, expect, it } from 'vitest';
import { isLandingInvitationEnabled } from './landingFlag.ts';

const env = (value: string | undefined) => (name: string) => (name === 'MAIL_LANDING_INVITATION' ? value : undefined);

describe('isLandingInvitationEnabled', () => {
  it('domyślnie wyłączone (brak zmiennej albo pusta)', () => {
    expect(isLandingInvitationEnabled(env(undefined))).toBe(false);
    expect(isLandingInvitationEnabled(env(''))).toBe(false);
    expect(isLandingInvitationEnabled(env('   '))).toBe(false);
  });
  it('włączone tylko jawną wartością (wielkość liter i spacje nie mają znaczenia)', () => {
    for (const v of ['on', 'ON', ' On ', 'true', 'TRUE', '1', 'yes', 'tak']) expect(isLandingInvitationEnabled(env(v)), v).toBe(true);
  });
  it('literówki i wartości „wyłączające” nie włączają zaproszenia', () => {
    for (const v of ['off', 'false', '0', 'no', 'nie', 'onn', 'enabled', 'włączone', 'y']) expect(isLandingInvitationEnabled(env(v)), v).toBe(false);
  });
});
