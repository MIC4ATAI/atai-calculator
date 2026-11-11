import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { validateNotifyTarget } from '../notify/target';
import { loadNotificationSettings, saveNotificationSettings } from './profileApi';

type Phase = 'loading' | 'ready' | 'saving' | 'saved' | 'failed';

/** Powiadomienia konsultanta: gdzie wysłać alert, gdy klient wróci do kalkulacji (Telegram, przez n8n). */
export function NotificationsPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [phase, setPhase] = useState<Phase>('loading');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    loadNotificationSettings(userId)
      .then((s) => {
        if (!active) return;
        setTarget(s.target ?? '');
        setPhase('ready');
      })
      .catch(() => active && setPhase('failed'));
    return () => {
      active = false;
    };
  }, [userId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId || phase === 'saving') return;
    const checked = validateNotifyTarget('telegram', target);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    setPhase('saving');
    try {
      await saveNotificationSettings(userId, { channel: checked.channel, target: checked.target });
      setTarget(checked.target ?? '');
      setPhase('saved');
    } catch {
      setPhase('failed');
    }
  }

  return (
    <main className="page">
      <p>
        <Link to="/app">← Sesje</Link>
      </p>
      <h1>Powiadomienia</h1>
      <p className="lead">
        Gdy klient, który dostał kalkulację, wróci do swojej sesji albo zmieni dane, wyślemy Ci krótki alert na Telegramie.
      </p>

      <section className="card">
        <h2>Telegram</h2>
        {phase === 'loading' && <p className="sub">Wczytywanie…</p>}
        {(phase === 'ready' || phase === 'saving' || phase === 'saved' || (phase === 'failed' && userId)) && (
          <form onSubmit={(e) => void onSubmit(e)} noValidate>
            <label htmlFor="notify-target">Identyfikator czatu</label>
            <input
              id="notify-target"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={target}
              placeholder="np. 123456789"
              onChange={(e) => {
                setTarget(e.target.value);
                setError(null);
                if (phase === 'saved' || phase === 'failed') setPhase('ready');
              }}
              aria-invalid={error !== null}
              aria-describedby="notify-help"
            />
            <p id="notify-help" className="sub">
              Wpisz numer swojego czatu z botem (w grupach zaczyna się od minusa). Puste pole wyłącza powiadomienia.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {phase === 'failed' && (
              <p className="error" role="alert">
                Nie udało się zapisać ustawień. Spróbuj ponownie.
              </p>
            )}
            {phase === 'saved' && (
              <p className="notice" role="status">
                Zapisano.
              </p>
            )}
            <button type="submit" className="primary" disabled={phase === 'saving'}>
              {phase === 'saving' ? 'Zapisywanie…' : 'Zapisz'}
            </button>
          </form>
        )}
        <p className="sub">
          Alert nie zawiera danych klienta (firmy, NIP-u ani adresu e-mail): tylko informację, że klient wrócił, i link do widoku
          follow-up, który otwiera się po zalogowaniu.
        </p>
      </section>
    </main>
  );
}
