import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useOrgs } from '../org/OrgProvider';
import { CopyButton } from '../session/CopyButton';
import { formatDateTime, guestLink, statusLabel } from '../session/sessionFormat';
import { createSession, listMySessions, type SessionListItem } from '../session/sessionsApi';

/** Strona główna konsultanta: jego sesje w wybranej organizacji i „Nowa sesja”. */
export function HomePage() {
  const { user } = useAuth();
  const { activeOrg } = useOrgs();
  const navigate = useNavigate();
  const orgId = activeOrg?.orgId ?? null;
  const userId = user?.id ?? null;

  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);

  useEffect(() => {
    if (!orgId || !userId) return;
    let active = true;
    setSessions(null);
    setLoadError(false);
    listMySessions(orgId, userId)
      .then((list) => active && setSessions(list))
      .catch(() => active && setLoadError(true));
    return () => {
      active = false;
    };
  }, [orgId, userId]);

  async function onCreate() {
    if (!orgId || creating) return;
    setCreating(true);
    setCreateError(false);
    try {
      const created = await createSession(orgId);
      navigate(`/session/${created.id}`);
    } catch {
      setCreateError(true);
      setCreating(false);
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Sesje</h1>
          <p className="lead">Prowadzisz rozmowę na żywo: rozmówca wpisuje dane, Ty widzisz je na bieżąco.</p>
        </div>
        <button type="button" className="primary" onClick={onCreate} disabled={creating}>
          {creating ? 'Tworzenie…' : 'Nowa sesja'}
        </button>
      </div>

      {createError && (
        <p className="error" role="alert">
          Nie udało się utworzyć sesji. Spróbuj ponownie.
        </p>
      )}

      {loadError && (
        <div className="notice" role="alert">
          <p>Nie udało się wczytać listy sesji.</p>
        </div>
      )}

      {!loadError && sessions === null && <p className="sub">Wczytywanie…</p>}

      {sessions !== null && sessions.length === 0 && (
        <div className="empty-state">
          <p>Nie masz jeszcze żadnej sesji w tej organizacji.</p>
          <p className="sub">Utwórz sesję i wyślij rozmówcy link — otworzy go bez logowania.</p>
        </div>
      )}

      {sessions !== null && sessions.length > 0 && (
        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.id} className="session-row">
              <div className="session-main">
                <Link to={`/session/${s.id}`} className="session-date">
                  {formatDateTime(s.createdAt)}
                </Link>
                <span className="badge">{statusLabel(s.status)}</span>
                {s.revealed && <span className="badge badge-accent">Wynik odsłonięty</span>}
              </div>
              <div className="session-actions">
                <CopyButton text={guestLink(window.location.origin, s.token)} />
                <Link to={`/session/${s.id}`} className="button-link">
                  Otwórz
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
