import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { looksLikeEmail } from './loginErrors';

export function LoginPage() {
  const { session, loading, signInWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!loading && session) return <Navigate to="/org" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!looksLikeEmail(email)) {
      setError('Podaj poprawny adres e-mail.');
      return;
    }
    setSending(true);
    setError(null);
    const outcome = await signInWithEmail(email);
    setSending(false);
    if (outcome.kind === 'sent') setSentTo(email.trim());
    else setError(outcome.message);
  }

  return (
    <main className="auth-card">
      <h1>Kalkulator efektywności</h1>
      <p className="lead">Zaloguj się, żeby prowadzić sesje z rozmówcami.</p>

      {sentTo ? (
        <div className="notice" role="status">
          <p>
            Jeśli konto <b>{sentTo}</b> istnieje, wysłaliśmy na ten adres link do logowania. Otwórz go na tym
            urządzeniu.
          </p>
          <button type="button" onClick={() => setSentTo(null)}>
            Użyj innego adresu
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="email">Adres e-mail</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="imie.nazwisko@firma.pl"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'email-error' : undefined}
            />
          </div>
          {error && (
            <p id="email-error" className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" type="submit" disabled={sending}>
            {sending ? 'Wysyłanie…' : 'Wyślij link do logowania'}
          </button>
        </form>
      )}
    </main>
  );
}
