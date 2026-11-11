import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { mix } from '../calc/calculator';
import { publicAppOrigin } from '../lib/publicUrl';
import type { LeadInfo } from '../cta/leadInfo';
import { CopyButton } from './CopyButton';
import { FIELD_LABELS, FIELD_ORDER, FIELD_UNITS, isDefaultValue } from './fields';
import { minSec, nf, zl } from './format';
import { computeCalc, type GuestInputKey } from './guestView';
import { NumberField } from './NumberField';
import { formatDateTime, guestLink, statusLabel } from './sessionFormat';
import { usePresenterSession } from './usePresenterSession';

/** Widok prezentera (konsultanta): dane rozmówcy na żywo, wyliczenia, miks i odsłonięcie wyniku. */
export function SessionPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Missing />;
  return <PresenterSession key={id} id={id} />;
}

function Missing() {
  return (
    <main className="page">
      <h1>Nie znaleziono sesji</h1>
      <p className="lead">Sesja nie istnieje albo nie masz do niej dostępu.</p>
      <Link to="/app">Wróć do listy sesji</Link>
    </main>
  );
}

function formatRowValue(key: GuestInputKey, value: number): string {
  return nf(value, key.startsWith('wsp') ? 1 : 0) + (FIELD_UNITS[key] ?? '');
}

function PresenterSession({ id }: { id: string }) {
  const s = usePresenterSession(id);
  const { row, inputs, params } = s;

  const calc = useMemo(() => (params ? computeCalc(inputs, params) : null), [inputs, params]);
  const result = calc?.result ?? null;
  const wspCzasu = calc?.wspCzasu ?? 2;

  if (s.status === 'loading') return <p className="center-note">Wczytywanie…</p>;
  if (s.status === 'missing' || !row || !params) return <Missing />;
  if (s.status === 'error') {
    return (
      <main className="page">
        <h1>Nie udało się wczytać sesji</h1>
        <p className="lead">Spróbuj odświeżyć stronę.</p>
        <Link to="/app">Wróć do listy sesji</Link>
      </main>
    );
  }

  const link = guestLink(publicAppOrigin(), row.token);
  const currentMix = result ? mix(result, s.mixKh ?? result.maksNowychKh, wspCzasu) : null;
  const maxMix = result ? mix(result, result.maksNowychKh, wspCzasu) : null;

  const statusText = s.typing
    ? 'rozmówca wpisuje…'
    : s.revealed
      ? 'wynik odsłonięty'
      : result
        ? 'dane kompletne'
        : row.companyId
          ? 'czeka na rozmówcę'
          : 'czeka na NIP';

  return (
    <main className="page presenter">
      {s.offline && (
        <p className="banner" role="status">
          Brak połączenia z serwerem — ponawiam. Twoje zmiany są zachowane.
        </p>
      )}

      <p>
        <Link to="/app">← Sesje</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>Sesja z rozmówcą</h1>
          <p className="lead">
            Utworzona {formatDateTime(row.createdAt)} · {statusLabel(row.status)}
          </p>
        </div>
      </div>

      <section className="card link-card">
        <h2>Link dla rozmówcy</h2>
        <p className="sub">Rozmówca otwiera go bez logowania. Każda sesja ma własny, nieodgadywalny link.</p>
        <div className="link-row">
          <input type="text" readOnly value={link} aria-label="Link dla rozmówcy" onFocus={(e) => e.target.select()} />
          <CopyButton text={link} />
        </div>
      </section>

      <section className="card company-block">
        <h2>Firma rozmówcy</h2>
        {s.company === null ? (
          <p className="sub">{row.companyId ? 'Wczytywanie danych firmy…' : 'Rozmówca jeszcze nie podał NIP-u.'}</p>
        ) : s.company.gusStatus === 'found' && s.company.name ? (
          <>
            <p className="company-name">{s.company.name}</p>
            <p className="sub">{[`NIP ${s.company.nip}`, s.company.address].filter(Boolean).join(' · ')}</p>
          </>
        ) : (
          <>
            <p className="company-name">NIP {s.company.nip}</p>
            <p className="sub">Rejestr REGON był niedostępny — rozmówca kontynuuje z samym numerem NIP.</p>
          </>
        )}
      </section>

      <LeadBlock info={s.leadInfo} revealed={s.revealed} sessionId={id} />

      <section className="pane">
        <div className="pane-head">
          <span>Widok prezentera</span>
          <span className={s.typing || s.revealed || result ? 'status' : 'status idle'} aria-live="polite">
            <span className="dot" />
            <span>{statusText}</span>
          </span>
        </div>
        <div className="pane-body">
          <h3>Dane od rozmówcy, na żywo</h3>
          <table className="live">
            <tbody>
              {FIELD_ORDER.map((key) => {
                const value = inputs[key];
                const flashing = s.flash?.key === key;
                const showDefault = isDefaultValue(key, value);
                const shown = value === undefined || value === '' ? null : value;
                return (
                  <tr key={flashing ? `${key}-${s.flash?.n}` : key} className={flashing ? 'flash' : undefined}>
                    <td>
                      {FIELD_LABELS[key]}
                      {showDefault && <small> (domyślne)</small>}
                    </td>
                    <td>
                      {shown !== null ? (
                        formatRowValue(key, shown)
                      ) : isDefaultValue(key, undefined) ? (
                        <span className="empty">domyślnie</span>
                      ) : (
                        <span className="empty">–</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3>Podpowiedz ze sprawozdania finansowego</h3>
          <div className="pfin">
            <NumberField
              id="p-przychod"
              label="Przychód roczny, zł"
              value={inputs.przychod ?? ''}
              onChange={(v) => s.setInput('przychod', v)}
            />
            <NumberField
              id="p-koszty"
              label="Wynagrodzenia z narzutami, zł/rok"
              value={inputs.koszty ?? ''}
              onChange={(v) => s.setInput('koszty', v)}
            />
          </div>

          <h3>Wyliczenia</h3>
          {result ? (
            <div className="metrics">
              <Metric label="Koszt zatrudnienia / mies." value={zl(result.kosztMies)} />
              <Metric label="Efektywne godziny / mies." value={`${nf(result.efektywneGodziny)} h`} />
              <Metric label="Koszt 1 godziny pracy" value={`${nf(result.kosztGodziny, 2)} zł`} />
              <Metric label="Godziny = cel korzyści" value={`${nf(result.godzinyDoOdzyskania, 1)} h`} highlight />
              <Metric label="Min / klient KH / mies." value={`${nf(result.minutyKhMies, 1)} min`} highlight />
              <Metric label="Min / klient KPiR / mies." value={`${nf(result.minutyKpirMies, 1)} min`} />
              <Metric label="Min / klient KH / dzień" value={minSec(result.minutyKhDzien)} />
              <Metric label="Maks. nowi klienci KH" value={`+${result.maksNowychKh}`} highlight />
              <Metric label="Udział w czasie pracy" value={`${nf(result.udzialCzasu * 100, 1)} %`} />
              <Metric label="Śr. cena KH / mies." value={result.cenaKh !== null ? zl(result.cenaKh) : '–'} />
              <Metric label="Śr. cena KPiR / mies." value={result.cenaKpir !== null ? zl(result.cenaKpir) : '–'} />
              <Metric
                label="Przychód / efektywna h"
                value={result.przychodNaGodzine !== null ? `${nf(result.przychodNaGodzine, 2)} zł` : '–'}
              />
            </div>
          ) : (
            <p className="sub">
              Wyliczenia pojawią się, gdy będą znane: liczba klientów, liczba pracowników i roczne wynagrodzenia z
              narzutami.
            </p>
          )}

          {result && currentMix && (
            <div className="pmix">
              <div className="row">
                <span>
                  Miks nowych klientów: +{currentMix.kh} KH + {currentMix.kpir} KPiR
                </span>
                <span>
                  {currentMix.przychodMies !== null ? `+${zl(currentMix.przychodMies)}` : zl(params.celKorzysci)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={result.maksNowychKh}
                step={1}
                value={currentMix.kh}
                onChange={(e) => s.setMix(Number(e.target.value))}
                aria-label="Miks nowych klientów"
              />
              <div className="hint ends">
                <span>tylko KPiR / ryczałt</span>
                <span>tylko pełna księgowość</span>
              </div>
            </div>
          )}

          <h3>Ciche założenia (widzi tylko prezenter)</h3>
          <div className="params">
            <NumberField
              id="p-cel"
              label="Cel korzyści, zł/mies."
              value={params.celKorzysci}
              onChange={(v) => v !== '' && s.setParam('celKorzysci', v)}
            />
            <NumberField
              id="p-dni"
              label="Dni robocze / mies."
              value={params.dniRobocze}
              onChange={(v) => v !== '' && s.setParam('dniRobocze', v)}
            />
            <NumberField
              id="p-godz"
              label="Godzin / dzień / osobę"
              value={params.godzinyDziennie}
              onChange={(v) => v !== '' && s.setParam('godzinyDziennie', v)}
            />
          </div>

          <div className="preview">
            {result && maxMix ? (
              <>
                <b>Podgląd komunikatu:</b> ok. {nf(result.minutyKhMies)} min/mies. na kliencie KH (
                {minSec(result.minutyKhDzien)} dziennie) → {nf(result.godzinyDoOdzyskania)} h → +{result.maksNowychKh}{' '}
                klientów KH
                {maxMix.przychodMies !== null
                  ? ` (+${zl(maxMix.przychodMies)} / mies.)`
                  : ' (bez przychodu: pokażę wartość czasu)'}
                .
              </>
            ) : (
              <span className="empty">Podgląd komunikatu pojawi się po wpisaniu danych.</span>
            )}
          </div>

          <div className="btns">
            <button type="button" className="primary" onClick={() => void s.setRevealed(true)} disabled={!result || s.revealed}>
              Odsłoń wynik rozmówcy
            </button>
            <button type="button" onClick={() => void s.setRevealed(false)} disabled={!s.revealed}>
              Ukryj
            </button>
            <button type="button" onClick={s.fillExample}>
              Wypełnij przykładem
            </button>
          </div>

          {row.reply && <div className="reply">Odpowiedź rozmówcy: {row.reply}</div>}
        </div>
      </section>
    </main>
  );
}

/** Stan CTA rozmówcy: czy poprosił o kalkulację, na jaki adres, ile razy wysłano i czy ostatnia próba się udała. */
function LeadBlock({ info, revealed, sessionId }: { info: LeadInfo | null; revealed: boolean; sessionId: string }) {
  if (!info || (info.sentCount === 0 && info.lastFailure === null && info.frozenAt === null)) {
    return revealed ? (
      <section className="card lead-block">
        <h2>Kalkulacja e-mailem</h2>
        <p className="sub">Rozmówca jeszcze nie poprosił o kalkulację.</p>
      </section>
    ) : null;
  }

  if (info.sentCount > 0) {
    return (
      <section className="card lead-block lead-ok" aria-live="polite">
        <h2>Kalkulacja wysłana</h2>
        <p>
          na adres <b>{info.lockedEmail}</b>
          {info.lastSentAt && <> · {formatDateTime(info.lastSentAt)}</>} · wysłano {info.sentCount}×
        </p>
        {info.frozenAt && (
          <p className="sub">
            Stan z rozmowy zamrożony {formatDateTime(info.frozenAt)}.{' '}
            <Link to={`/session/${sessionId}/follow-up`}>Porównaj z ostatnią symulacją →</Link>
          </p>
        )}
        {info.lastFailure && (
          <p className="sub">Ostatnia próba ponownej wysyłki nie powiodła się: {info.lastFailure.error ?? 'nieznany błąd'}.</p>
        )}
      </section>
    );
  }

  return (
    <section className="card lead-block lead-warn" role="status">
      <h2>Wysyłka kalkulacji nie powiodła się</h2>
      {info.currentEmail && (
        <p>
          adres: <b>{info.currentEmail}</b>
        </p>
      )}
      {info.lastFailure && <p className="sub">{info.lastFailure.error ?? 'nieznany błąd'}. Rozmówca może spróbować ponownie.</p>}
      {info.frozenAt && <p className="sub">Stan z rozmowy zamrożony {formatDateTime(info.frozenAt)}.</p>}
    </section>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={highlight ? 'metric hl' : 'metric'}>
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}
