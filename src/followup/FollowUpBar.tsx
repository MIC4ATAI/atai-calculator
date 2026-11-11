import { useState } from 'react';
import { nf } from '../session/format';
import { formatDateTime } from '../session/sessionFormat';
import type { FollowUpView } from './conversation';
import { formatDelta } from './format';

interface Props {
  followUp: FollowUpView;
  /** Przywraca dane i miks z rozmowy; zwraca false przy błędzie. */
  onRestore: () => Promise<boolean>;
}

/**
 * Stały pasek klienta po wysłaniu kalkulacji: „Wynik z rozmowy: 121 h → +10 KH + 20 KPiR”, pod nim bieżąca symulacja
 * z różnicą i przycisk „Wróć do stanu z rozmowy”. Klient widzi tylko godziny i miks (jak w wyniku), bez kosztów.
 */
export function FollowUpBar({ followUp, onRestore }: Props) {
  const { conversation: c, comparison: cmp } = followUp;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const restore = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await onRestore();
    setFailed(!ok);
    setBusy(false);
  };

  return (
    <aside className="followup-bar" aria-label="Wynik z rozmowy">
      <p className="followup-main">
        <span className="followup-label">Wynik z rozmowy:</span>{' '}
        <b>
          {nf(c.godziny)} h → +{c.nowiKh} KH + {c.nowiKpir} KPiR
        </b>
        <span className="followup-date"> · {formatDateTime(c.frozenAt)}</span>
      </p>

      {cmp.current ? (
        <p className="followup-now">
          Teraz:{' '}
          <b>
            {nf(cmp.current.godziny)} h
            {cmp.changed && cmp.deltaGodziny !== null && <> ({formatDelta(cmp.deltaGodziny)} h)</>} → +{cmp.current.nowiKh} KH + {cmp.current.nowiKpir} KPiR
          </b>
          {!cmp.changed && <span className="followup-same"> · zgodnie z rozmową</span>}
        </p>
      ) : (
        <p className="followup-now">Teraz: uzupełnij dane, żeby zobaczyć wynik symulacji.</p>
      )}

      {cmp.versionDiffers && (
        <p className="followup-note">Wzory kalkulatora zostały od rozmowy zaktualizowane, więc różnica może z nich wynikać.</p>
      )}

      <div className="followup-actions">
        <button type="button" onClick={() => void restore()} disabled={!cmp.changed || busy}>
          {busy ? 'Przywracam…' : 'Wróć do stanu z rozmowy'}
        </button>
        {failed && (
          <span className="followup-error" role="alert">
            Nie udało się przywrócić. Spróbuj za chwilę.
          </span>
        )}
      </div>
    </aside>
  );
}
