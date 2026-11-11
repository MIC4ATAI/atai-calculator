import { useId, useState, type FormEvent } from 'react';
import { parseEmail } from '../email/address';
import { callRequestCalculation } from '../session/guestApi';
import type { CtaView } from './ctaPolicy';
import { CtaNotice } from './CtaNotice';
import type { CtaNoticeView } from './notice';
import { REQUEST_ERROR_MESSAGES } from './requestErrors';

interface Props {
  token: string;
  cta: CtaView;
  /** Klauzula informacyjna RODO organizacji (treść i link do polityki prywatności); null = brak danych organizacji. */
  privacy: CtaNoticeView | null;
  /** Stan po wysyłce zmienił się — odśwież widok sesji. */
  onChanged: () => void;
}

/**
 * CTA: „Przyślij mi kalkulację jako Excel oraz link do sesji”. Rozmówca podaje tylko e-mail, bez żadnych zgód:
 * wysyłamy wyłącznie to, o co poprosił (spec: „E-mail i zgody”). Po pierwszej udanej wysyłce adres jest zablokowany,
 * a „Wyślij ponownie” używa tego samego adresu (widzimy go tylko w postaci zamaskowanej).
 */
export function SendCalculationCard({ token, cta, privacy, onChanged }: Props) {
  const inputId = useId();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Stan z odpowiedzi serwera — pokazujemy go od razu, zanim widok sesji się odświeży. */
  const [latest, setLatest] = useState<CtaView | null>(null);

  const view = latest && latest.sentCount >= cta.sentCount ? latest : cta;
  const alreadySent = view.sentCount > 0;

  async function send(address: string | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await callRequestCalculation(token, address);
    setBusy(false);

    if (result.ok) {
      setLatest(result.cta);
      setNotice(result.duplicate ? 'Kalkulacja została właśnie wysłana.' : 'Wysłaliśmy kalkulację. Sprawdź skrzynkę (także folder spam).');
      onChanged();
      return;
    }
    if (result.cta) setLatest(result.cta);
    setError(REQUEST_ERROR_MESSAGES[result.kind]);
    onChanged();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (parseEmail(email) === null) {
      setError(REQUEST_ERROR_MESSAGES.invalid_email);
      return;
    }
    void send(email);
  }

  return (
    <section className="cta-card" aria-labelledby={`${inputId}-title`}>
      <h3 id={`${inputId}-title`} className="cta-title">
        Przyślij mi kalkulację jako Excel oraz link do sesji
      </h3>

      {!alreadySent && view.available && (
        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor={inputId}>Twój adres e-mail</label>
            <input
              id={inputId}
              type="email"
              autoComplete="email"
              placeholder="imie.nazwisko@firma.pl"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${inputId}-error` : `${inputId}-hint`}
            />
            <div id={`${inputId}-hint`} className="hint">
              Wyślemy wyłącznie plik Excel z tą kalkulacją i link do tej sesji — nic więcej.
            </div>
          </div>
          {privacy && <CtaNotice notice={privacy} id={`${inputId}-privacy`} />}
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Wysyłam…' : 'Wyślij kalkulację'}
          </button>
        </form>
      )}

      {alreadySent && (
        <div className="cta-sent">
          <p>
            Kalkulację wysłaliśmy na adres <b>{view.emailMasked}</b>.
          </p>
          {view.available ? (
            <button type="button" onClick={() => void send(null)} disabled={busy}>
              {busy ? 'Wysyłam…' : 'Wyślij ponownie'}
            </button>
          ) : (
            <p className="hint">Wykorzystano wszystkie dostępne wysyłki.</p>
          )}
          {view.available && <p className="hint">Możesz wysłać ją jeszcze {view.remaining} {view.remaining === 1 ? 'raz' : 'razy'}.</p>}
        </div>
      )}

      {!alreadySent && !view.available && view.blockedReason && <p className="hint">{REQUEST_ERROR_MESSAGES[view.blockedReason]}</p>}

      {notice && (
        <p className="cta-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p id={`${inputId}-error`} className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
