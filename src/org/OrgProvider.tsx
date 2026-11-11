import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { readActiveOrgId, writeActiveOrgId } from './activeOrgStorage';
import { pickActiveOrg, type OrgMembership, type OrgRole } from './orgChoice';

interface OrgState {
  /** Organizacje zalogowanej osoby (z jej rolami). */
  orgs: OrgMembership[];
  loading: boolean;
  error: string | null;
  /** Aktywna organizacja albo null, gdy trzeba ją wybrać (lub osoba nie należy do żadnej). */
  activeOrg: OrgMembership | null;
  selectOrg: (orgId: string) => void;
  reload: () => void;
}

const OrgContext = createContext<OrgState | null>(null);

const ROLES: readonly OrgRole[] = ['owner', 'admin', 'consultant'];

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [orgs, setOrgs] = useState<OrgMembership[]>([]);
  // Dla którego użytkownika lista jest wczytana. „Ładowanie” wynika z tego, a nie z osobnej flagi:
  // w pierwszym renderze po odzyskaniu sesji efekt jeszcze nie ruszył, a RequireOrg już decyduje.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rememberedId, setRememberedId] = useState<string | null>(() => readActiveOrgId());
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!userId) {
      setOrgs([]);
      setError(null);
      setLoadedFor(null);
      return;
    }
    let active = true;
    setLoadedFor(null);
    setError(null);
    // RLS zwraca też członkostwa współpracowników, jeśli osoba jest adminem — filtrujemy po sobie.
    supabase
      .from('memberships')
      .select('role, organizations(id, name)')
      .eq('user_id', userId)
      .then(({ data, error: err }) => {
        if (!active) return;
        if (err) {
          setError('Nie udało się wczytać Twoich organizacji.');
          setOrgs([]);
        } else {
          const list: OrgMembership[] = [];
          for (const row of data ?? []) {
            const org = row.organizations;
            if (org && ROLES.includes(row.role as OrgRole)) {
              list.push({ orgId: org.id, name: org.name, role: row.role as OrgRole });
            }
          }
          list.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
          setOrgs(list);
        }
        setLoadedFor(userId);
      });
    return () => {
      active = false;
    };
  }, [userId, reloadTick]);

  const selectOrg = useCallback((orgId: string) => {
    writeActiveOrgId(orgId);
    setRememberedId(orgId);
  }, []);

  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  const loading = userId !== null && loadedFor !== userId;

  const activeOrg = useMemo(() => pickActiveOrg(orgs, rememberedId), [orgs, rememberedId]);

  const value = useMemo<OrgState>(
    () => ({ orgs, loading, error, activeOrg, selectOrg, reload }),
    [orgs, loading, error, activeOrg, selectOrg, reload],
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrgs(): OrgState {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrgs musi być użyty wewnątrz OrgProvider');
  return ctx;
}
