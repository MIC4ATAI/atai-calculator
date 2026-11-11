import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CopyButton } from './CopyButton';
import { formatDateTime, guestLink, statusLabel } from './sessionFormat';
import { getSession, type SessionListItem } from './sessionsApi';

/** Widok sesji po stronie konsultanta. Na razie: link dla rozmówcy; dane na żywo dochodzą w kolejnym kroku. */
export function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<SessionListItem | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    if (!id) {
      setState('missing');
      return;
    }
    let active = true;
    setState('loading');
    getSession(id)
      .then((s) => {
        if (!active) return;
        setSession(s);
        setState(s ? 'ready' : 'missing');
      })
      .catch(() => active && setState('error')); // m.in. niepoprawny identyfikator w adresie
    return () => {
      active = false;
    };
  }, [id]);

  if (state === 'loading') return <p className="center-note">Wczytywanie…</p>;

  if (state !== 'ready' || !session) {
    return (
      <main className="page">
        <h1>Nie znaleziono sesji</h1>
        <p className="lead">Sesja nie istnieje albo nie masz do niej dostępu.</p>
        <Link to="/app">Wróć do listy sesji</Link>
      </main>
    );
  }

  const link = guestLink(window.location.origin, session.token);

  return (
    <main className="page">
      <p>
        <Link to="/app">← Sesje</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>Sesja z rozmówcą</h1>
          <p className="lead">
            Utworzona {formatDateTime(session.createdAt)} · {statusLabel(session.status)}
          </p>
        </div>
      </div>

      <section className="card">
        <h2>Link dla rozmówcy</h2>
        <p className="sub">Rozmówca otwiera go bez logowania. Każda sesja ma własny, nieodgadywalny link.</p>
        <div className="link-row">
          <input type="text" readOnly value={link} aria-label="Link dla rozmówcy" onFocus={(e) => e.target.select()} />
          <CopyButton text={link} />
        </div>
      </section>
    </main>
  );
}
