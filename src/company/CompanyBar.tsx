import type { CompanyView } from './companyView';

/** Wiersz z firmą nad formularzem danych: nazwa, NIP, adres i „Zmień NIP”. */
export function CompanyBar({ company, onChangeNip }: { company: CompanyView; onChangeNip: () => void }) {
  const details = [`NIP ${company.nip}`, company.address].filter(Boolean).join(' · ');
  return (
    <div className="company-bar">
      <div className="company-bar-text">
        <b>{company.name ?? `NIP ${company.nip}`}</b>
        {company.name !== null && <span className="sub"> · {details}</span>}
      </div>
      <button type="button" className="link" onClick={onChangeNip}>
        Zmień NIP
      </button>
    </div>
  );
}
