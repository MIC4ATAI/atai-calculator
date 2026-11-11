import { Link, useParams } from 'react-router-dom';
import { nf, zl } from '../session/format';
import { formatDateTime } from '../session/sessionFormat';
import { formatDelta } from './format';
import type { PresenterFollowUp, SimulationSummary } from './presenterView';
import type { TimelineChange } from './timeline';
import { useFollowUp } from './useFollowUp';

/** Widok przed follow-upem: stan z rozmowy, ostatnia symulacja klienta i lista zmian obok siebie (tylko konsultant). */
export function FollowUpPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Missing />;
  return <FollowUp key={id} id={id} />;
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

function FollowUp({ id }: { id: string }) {
  const s = useFollowUp(id);

  if (s.status === 'loading') return <p className="center-note">Wczytywanie…</p>;
  if (s.status === 'missing' || !s.row) return <Missing />;
  if (s.status === 'error') {
    return (
      <main className="page">
        <h1>Nie udało się wczytać follow-upu</h1>
        <p className="lead">Spróbuj odświeżyć stronę.</p>
        <Link to={`/session/${id}`}>← Sesja</Link>
      </main>
    );
  }

  const f = s.followUp;
  return (
    <main className="page followup-page">
      {s.offline && (
        <p className="banner" role="status">
          Brak połączenia z serwerem — ponawiam.
        </p>
      )}
      <p>
        <Link to={`/session/${id}`}>← Sesja</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>Follow-up: rozmowa i ostatnia symulacja</h1>
          {f && (
            <p className="lead">
              Stan z rozmowy zamrożony {formatDateTime(f.frozenAt)} ·{' '}
              {f.returns === 0
                ? 'klient jeszcze nie wracał do sesji'
                : `klient wracał ${f.returns}×, ostatnia aktywność ${f.lastActivityAt ? formatDateTime(f.lastActivityAt) : '–'}`}
            </p>
          )}
        </div>
      </div>

      {!s.hasSnapshot && (
        <div className="empty-state">
          <p>Rozmówca jeszcze nie poprosił o kalkulację, więc nie ma stanu z rozmowy do porównania.</p>
          <p className="sub">Stan zamraża się przy pierwszej prośbie o Excel i link do sesji.</p>
        </div>
      )}

      {s.hasSnapshot && !f && (
        <div className="notice" role="alert">
          <p>Zamrożony stan jest w nieoczekiwanym kształcie, więc nie pokazuję liczb, które mogłyby być nieprawdziwe.</p>
        </div>
      )}

      {f && (
        <div className="followup-grid">
          <section className="card followup-col" aria-labelledby="fu-conv">
            <h2 id="fu-conv">Stan z rozmowy</h2>
            <Summary simulation={f.conversation} />
            <FieldTable f={f} column="conversation" />
            <p className="sub">Wersja logiki: {f.calcVersion}</p>
          </section>

          <section className="card followup-col" aria-labelledby="fu-now">
            <h2 id="fu-now">Ostatnia symulacja klienta</h2>
            {f.current ? (
              <Summary
                simulation={f.current}
                deltas={{ godziny: f.comparison.deltaGodziny, kh: f.comparison.deltaKh, kpir: f.comparison.deltaKpir, przychod: f.deltaPrzychod }}
              />
            ) : (
              <p className="sub">Dane są niekompletne, więc nie ma wyniku bieżącej symulacji.</p>
            )}
            <FieldTable f={f} column="current" />
            {!f.comparison.changed && <p className="sub">Bez zmian względem rozmowy.</p>}
            {f.comparison.versionDiffers && (
              <p className="sub followup-warn">Wzory kalkulatora zmieniły się od rozmowy, więc różnice mogą z nich wynikać.</p>
            )}
          </section>

          <section className="card followup-col" aria-labelledby="fu-changes">
            <h2 id="fu-changes">Zmiany po rozmowie</h2>
            {f.timeline.visits.length === 0 && f.timeline.otherChanges.length === 0 && (
              <p className="sub">Klient jeszcze nie wracał i nic nie zmieniał.</p>
            )}
            {f.timeline.visits.map((v) => (
              <div key={v.id} className="followup-visit">
                <h3>
                  Powrót {formatDateTime(v.startedAt)}
                  <span className="sub"> · aktywność do {formatDateTime(v.lastActivityAt)}</span>
                </h3>
                {v.changes.length === 0 ? (
                  <p className="sub">Klient tylko otworzył stronę.</p>
                ) : (
                  <ChangeList changes={v.changes} />
                )}
              </div>
            ))}
            {f.timeline.otherChanges.length > 0 && (
              <div className="followup-visit">
                <h3>Poza wizytami klienta</h3>
                <ChangeList changes={f.timeline.otherChanges} showActor />
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

interface Deltas {
  godziny: number | null;
  kh: number | null;
  kpir: number | null;
  przychod: number | null;
}

function Summary({ simulation, deltas }: { simulation: SimulationSummary; deltas?: Deltas }) {
  const d = (value: number | null | undefined, suffix: string, decimals = 0) =>
    deltas && value !== null && value !== undefined && formatDelta(value, decimals) !== '0' ? (
      <span className="followup-delta"> ({formatDelta(value, decimals)}{suffix})</span>
    ) : null;
  return (
    <dl className="followup-summary">
      <div>
        <dt>Godziny do odzyskania</dt>
        <dd>
          {nf(simulation.godziny)} h{d(deltas?.godziny, ' h')}
        </dd>
      </div>
      <div>
        <dt>Nowi klienci w tym czasie</dt>
        <dd>
          +{simulation.nowiKh} KH{d(deltas?.kh, '')} + {simulation.nowiKpir} KPiR{d(deltas?.kpir, '')}
        </dd>
      </div>
      <div>
        <dt>Przychód z nowych klientów / mies.</dt>
        <dd>
          {simulation.przychodMies !== null ? `+${zl(simulation.przychodMies)}` : '–'}
          {d(deltas?.przychod, ' zł')}
        </dd>
      </div>
    </dl>
  );
}

function FieldTable({ f, column }: { f: PresenterFollowUp; column: 'conversation' | 'current' }) {
  return (
    <table className="followup-fields">
      <tbody>
        {f.rows.map((r) => (
          <tr key={r.key} className={column === 'current' && r.changed ? 'changed' : undefined}>
            <td>{r.label}</td>
            <td>{r[column]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChangeList({ changes, showActor = false }: { changes: TimelineChange[]; showActor?: boolean }) {
  return (
    <ul className="followup-changes">
      {changes.map((c) => (
        <li key={c.id}>
          <span className="followup-time">{formatDateTime(c.at)}</span>
          <span>
            {showActor && <span className="badge">{c.actor === 'guest' ? 'klient' : 'konsultant'}</span>} {c.label}: {c.from} → <b>{c.to}</b>
          </span>
        </li>
      ))}
    </ul>
  );
}
