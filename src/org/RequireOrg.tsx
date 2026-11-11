import { Navigate, Outlet } from 'react-router-dom';
import { useOrgs } from './OrgProvider';

/** Trasy wymagające wybranej organizacji; bez niej odsyła na ekran wyboru. */
export function RequireOrg() {
  const { activeOrg, loading } = useOrgs();

  if (loading) return <p className="center-note">Wczytywanie…</p>;
  if (!activeOrg) return <Navigate to="/org" replace />;
  return <Outlet />;
}
