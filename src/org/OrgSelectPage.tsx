import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useOrgs } from './OrgProvider';
import { readActiveOrgId } from './activeOrgStorage';
import { resolveOrgChoice, ROLE_LABELS } from './orgChoice';

/** Po zalogowaniu: jedna organizacja → od razu dalej; kilka → wybór; brak → komunikat. */
export function OrgSelectPage() {
  const { signOut, user } = useAuth();
  const { orgs, loading, error, selectOrg, reload } = useOrgs();
  const navigate = useNavigate();

  const choice = resolveOrgChoice(orgs, readActiveOrgId());

  useEffect(() => {
    if (!loading && !error && choice.kind === 'single') selectOrg(choice.org.orgId);
  }, [loading, error, choice, selectOrg]);

  if (loading) return <p className="center-note">Wczytywanie…</p>;
  if (!error && choice.kind === 'single') return <Navigate to="/app" replace />;

  return (
    <main className="auth-card">
      <h1>Wybierz organizację</h1>
      <p className="lead">Zalogowano jako {user?.email}</p>

      {error && (
        <div className="notice" role="alert">
          <p>{error}</p>
          <button type="button" onClick={reload}>
            Spróbuj ponownie
          </button>
        </div>
      )}

      {!error && choice.kind === 'none' && (
        <div className="notice" role="status">
          <p>
            Twoje konto nie należy jeszcze do żadnej organizacji. Poproś właściciela organizacji o dodanie Cię jako
            konsultanta.
          </p>
        </div>
      )}

      {!error && choice.kind === 'choose' && (
        <ul className="org-list">
          {choice.orgs.map((org) => (
            <li key={org.orgId}>
              <button
                type="button"
                className={org.orgId === choice.preselectedId ? 'org-option last-used' : 'org-option'}
                onClick={() => {
                  selectOrg(org.orgId);
                  navigate('/app');
                }}
              >
                <span className="org-name">{org.name}</span>
                <span className="org-role">
                  {ROLE_LABELS[org.role]}
                  {org.orgId === choice.preselectedId ? ' · ostatnio używana' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="link" onClick={() => void signOut()}>
        Wyloguj
      </button>
    </main>
  );
}
