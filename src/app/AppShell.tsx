import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useOrgs } from '../org/OrgProvider';
import { ROLE_LABELS } from '../org/orgChoice';

/** Układ widoków konsultanta: nagłówek z organizacją, zmianą organizacji i wylogowaniem. */
export function AppShell() {
  const { user, signOut } = useAuth();
  const { activeOrg, orgs } = useOrgs();

  return (
    <>
      <header className="top">
        <div>
          <strong>{activeOrg?.name}</strong>
          {activeOrg && <span className="sub"> · {ROLE_LABELS[activeOrg.role]}</span>}
        </div>
        <nav className="top-actions">
          {orgs.length > 1 && <Link to="/org">Zmień organizację</Link>}
          <span className="sub">{user?.email}</span>
          <button type="button" onClick={() => void signOut()}>
            Wyloguj
          </button>
        </nav>
      </header>
      <Outlet />
    </>
  );
}
