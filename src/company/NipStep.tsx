import { useId, useState, type FormEvent } from 'react';
import { callLookup } from '../session/guestApi';
import { formatNip, type CompanyView } from './companyView';
import { LOOKUP_ERROR_MESSAGES } from './lookupErrors';
import { NIP_REASON_MESSAGES, nipFieldState } from './nipInput';

interface Props {
  token: string;
  /** Firma znaleziona (lub „sam NIP”, gdy rejestr był niedostępny). */
  onFound: (company: CompanyView) => void;
  /** Gdy rozmówca zmienia już podany NIP — pozwala wrócić bez zmiany. */
  onCancel?: () => void;
}

/** Pierwszy krok rozmowy: NIP z walidacją na bieżąco, potem dane firmy z rejestru REGON. */
export function NipStep({ token, onFound, onCancel }: Props) {
  const inputId = useId();
  const hintId = useId();
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const state = nipFieldState(raw);
  const invalid = state.kind === 'invalid';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (state.kind !== 'valid' || busy) return;
    setBusy(true);
    setServerError(null);
    const result = await callLookup(token, state.nip);
    setBusy(false);
    if (result.ok) onFound(result.company);
    else setServerError(LOOKUP_ERROR_MESSAGES[result.kind]);
  }

  // Gdy serwer odrzucił poprawny numer (np. brak w rejestrze), nie chwalimy go równocześnie zielonym „poprawny”.
  let hint: string | null = null;
  if (state.kind === 'incomplete') hint = `NIP ma 10 cyfr — wpisano ${state.digits}.`;
  if (state.kind === 'valid' && !serverError) hint = 'Numer NIP jest poprawny.';

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor={inputId}>NIP firmy</label>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={20}
          placeholder="np. 526-104-05-67"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setServerError(null);
          }}
          onBlur={() => {
            if (state.kind === 'valid') setRaw(formatNip(state.nip));
          }}
          aria-invalid={invalid || serverError ? true : undefined}
          aria-describedby={hintId}
        />
        <div id={hintId} className={invalid ? 'field-error' : state.kind === 'valid' && !serverError ? 'field-ok' : 'hint'} role={invalid ? 'alert' : undefined}>
          {invalid ? NIP_REASON_MESSAGES[state.reason] : hint}
        </div>
      </div>

      {serverError && (
        <p className="error" role="alert">
          {serverError}
        </p>
      )}

      <div className="btns">
        <button type="submit" className="primary" disabled={state.kind !== 'valid' || busy}>
          {busy ? 'Sprawdzam firmę…' : 'Sprawdź firmę'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}>
            Anuluj
          </button>
        )}
      </div>
      <p className="note">Na podstawie numeru NIP pobieramy podstawowe dane firmy z publicznego rejestru REGON.</p>
    </form>
  );
}
