export type OrgRole = 'owner' | 'admin' | 'consultant';

/** Organizacja, do której należy zalogowana osoba, wraz z jej rolą. */
export interface OrgMembership {
  orgId: string;
  name: string;
  role: OrgRole;
}

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Właściciel',
  admin: 'Administrator',
  consultant: 'Konsultant',
};

/** Wybór organizacji aktywnej: zapamiętana, jeśli nadal należy do listy; jedyna, jeśli jest jedna. */
export function pickActiveOrg(orgs: OrgMembership[], rememberedId: string | null): OrgMembership | null {
  const remembered = rememberedId ? orgs.find((o) => o.orgId === rememberedId) : undefined;
  if (remembered) return remembered;
  const [only] = orgs;
  return orgs.length === 1 && only ? only : null;
}

export type OrgChoice =
  | { kind: 'none' }
  | { kind: 'single'; org: OrgMembership }
  | { kind: 'choose'; orgs: OrgMembership[]; preselectedId: string | null };

/** Co pokazać na ekranie wyboru organizacji po zalogowaniu. */
export function resolveOrgChoice(orgs: OrgMembership[], rememberedId: string | null): OrgChoice {
  const [first] = orgs;
  if (!first) return { kind: 'none' };
  if (orgs.length === 1) return { kind: 'single', org: first };
  const preselected = orgs.some((o) => o.orgId === rememberedId) ? rememberedId : null;
  return { kind: 'choose', orgs, preselectedId: preselected };
}
