import { describe, expect, it } from 'vitest';
import { pickActiveOrg, resolveOrgChoice, type OrgMembership } from './orgChoice';

const mitax: OrgMembership = { orgId: 'o1', name: 'MITAX', role: 'owner' };
const atai: OrgMembership = { orgId: 'o2', name: 'AT AI', role: 'consultant' };

describe('pickActiveOrg', () => {
  it('brak organizacji → null', () => {
    expect(pickActiveOrg([], null)).toBeNull();
    expect(pickActiveOrg([], 'o1')).toBeNull();
  });
  it('jedna organizacja jest wybierana automatycznie', () => {
    expect(pickActiveOrg([mitax], null)).toBe(mitax);
    expect(pickActiveOrg([mitax], 'stare-id')).toBe(mitax);
  });
  it('kilka organizacji: zapamiętana jest używana, jeśli nadal należy do listy', () => {
    expect(pickActiveOrg([mitax, atai], 'o2')).toBe(atai);
  });
  it('kilka organizacji bez ważnego zapamiętanego wyboru → trzeba wybrać', () => {
    expect(pickActiveOrg([mitax, atai], null)).toBeNull();
    expect(pickActiveOrg([mitax, atai], 'usunięta-org')).toBeNull();
  });
});

describe('resolveOrgChoice', () => {
  it('żadnej organizacji', () => {
    expect(resolveOrgChoice([], null)).toEqual({ kind: 'none' });
  });
  it('jedna organizacja → przejście dalej bez wyboru', () => {
    expect(resolveOrgChoice([atai], 'o1')).toEqual({ kind: 'single', org: atai });
  });
  it('kilka organizacji → wybór, z podświetleniem ostatnio używanej', () => {
    expect(resolveOrgChoice([mitax, atai], 'o2')).toEqual({ kind: 'choose', orgs: [mitax, atai], preselectedId: 'o2' });
  });
  it('nieznany zapamiętany wybór nie jest podświetlany', () => {
    expect(resolveOrgChoice([mitax, atai], 'x')).toMatchObject({ kind: 'choose', preselectedId: null });
  });
});
