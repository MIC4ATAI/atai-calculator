const KEY = 'atai.activeOrgId';

/** Zapamiętany wybór organizacji to wygoda, nie źródło prawdy: bez localStorage wszystko działa. */
export function readActiveOrgId(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeActiveOrgId(orgId: string | null): void {
  try {
    if (orgId) window.localStorage.setItem(KEY, orgId);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* tryb prywatny / zablokowane dane witryny — pomijamy */
  }
}
