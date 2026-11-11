import { useState } from 'react';
import { callLookup } from '../session/guestApi';
import type { CompanyView } from './companyView';
import { LOOKUP_ERROR_MESSAGES } from './lookupErrors';

interface Props {
  token: string;
  company: CompanyView;
  onConfirm: () => void;
  onChangeNip: () => void;
  /** Ponowna próba udała się — nowe dane firmy. */
  onFound: (company: CompanyView) => void;
}

/** „Czy to Twoja firma?” — potwierdzenie danych z rejestru; przy niedostępnym rejestrze można iść dalej z samym NIP-em. */
export function CompanyCard({ token, company, onConfirm, onChangeNip, onFound }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const found = company.gusStatus === 'found' && company.name !== null;

  async function retry() {
    setBusy(true);
    setError(null);
    const result = await callLookup(token, company.nip);
    setBusy(false);
    if (result.ok) onFound(result.company);
    else setError(LOOKUP_ERROR_MESSAGES[result.kind]);
  }

  if (!found) {
    return (
      <div>
        <p className="group-title">Nie udało się pobrać danych firmy</p>
        <div className="notice" role="status">
          <p>
            Rejestr REGON jest teraz niedostępny. Możesz kontynuować z samym numerem NIP <b>{company.nip}</b> — dane
            firmy nie są potrzebne do kalkulacji.
          </p>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="btns">
          <button type="button" className="primary" onClick={onConfirm} disabled={busy}>
            Kontynuuj
          </button>
          <button type="button" onClick={() => void retry()} disabled={busy}>
            {busy ? 'Próbuję…' : 'Spróbuj ponownie'}
          </button>
          <button type="button" onClick={onChangeNip} disabled={busy}>
            Zmień NIP
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="group-title">Czy to Twoja firma?</p>
      <div className="company-card">
        <b className="company-name">{company.name}</b>
        <span>NIP {company.nip}</span>
        {company.address && <span>{company.address}</span>}
      </div>
      <div className="btns">
        <button type="button" className="primary" onClick={onConfirm}>
          Tak, to moja firma
        </button>
        <button type="button" onClick={onChangeNip}>
          To nie moja firma — zmień NIP
        </button>
      </div>
    </div>
  );
}
