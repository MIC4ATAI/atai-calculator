import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CompanyBar } from '../company/CompanyBar';
import { CompanyCard } from '../company/CompanyCard';
import type { CompanyView } from '../company/companyView';
import { NipStep } from '../company/NipStep';
import { displayValue, isDefaultValue } from './fields';
import { minSec, nf, zl } from './format';
import { pickMix, toCalcInputs, type GuestResult, type GuestInputKey } from './guestView';
import { NumberField } from './NumberField';
import { useGuestSession } from './useGuestSession';

/** Widok rozmówcy: otwierany z linku bez logowania. Tytuły i teksty jak w prototypie. */
export function GuestPage() {
  const { token } = useParams<{ token: string }>();
  if (!token) return <GuestMessage title="Nie znaleziono sesji" text="Link jest niepoprawny." />;
  return <GuestSession key={token} token={token} />;
}

function GuestMessage({ title, text }: { title: string; text: string }) {
  return (
    <main className="guest">
      <div className="pane">
        <div className="pane-body">
          <p className="brand">{title}</p>
          <p className="lead">{text}</p>
        </div>
      </div>
    </main>
  );
}

function GuestSession({ token }: { token: string }) {
  const { status, offline, view, inputs, mixKh, reply, setField, setMix, setReply, refresh } = useGuestSession(token);
  // Firma tuż po wyszukaniu — pokazujemy kartę „Czy to Twoja firma?”, zanim rozmówca przejdzie do formularza.
  const [confirmCompany, setConfirmCompany] = useState<CompanyView | null>(null);
  const [changingNip, setChangingNip] = useState(false);

  if (status === 'loading') return <p className="center-note">Wczytywanie…</p>;
  if (status === 'not_found') {
    return <GuestMessage title="Nie znaleziono sesji" text="Ta sesja nie istnieje albo została zakończona." />;
  }
  if (status === 'error' || !view) {
    return <GuestMessage title="Brak połączenia" text="Nie udało się wczytać sesji. Odśwież stronę za chwilę." />;
  }

  const field = (key: GuestInputKey) => ({
    id: `f-${key}`,
    value: displayValue(key, inputs[key]),
    suggested: isDefaultValue(key, inputs[key]),
    onChange: (v: number | '') => setField(key, v),
  });

  const dataComplete = toCalcInputs(inputs) !== null;

  const company = view.company;
  const step: 'nip' | 'confirm' | 'form' = !company || changingNip ? 'nip' : confirmCompany ? 'confirm' : 'form';

  const onCompanyFound = (found: CompanyView) => {
    setChangingNip(false);
    setConfirmCompany(found);
    void refresh();
  };

  return (
    <main className="guest">
      {offline && (
        <p className="banner" role="status">
          Brak połączenia — ponawiam. Twoje wpisy są zachowane.
        </p>
      )}
      <div className="pane">
        <div className="pane-body">
          <p className="brand">Ile czasu odzyska Twoje biuro?</p>

          {step === 'nip' && (
            <>
              <p className="lead">Zacznijmy od numeru NIP Twojej firmy.</p>
              <NipStep token={token} onFound={onCompanyFound} onCancel={company ? () => setChangingNip(false) : undefined} />
            </>
          )}

          {step === 'confirm' && confirmCompany && (
            <CompanyCard
              token={token}
              company={confirmCompany}
              onConfirm={() => setConfirmCompany(null)}
              onChangeNip={() => {
                setConfirmCompany(null);
                setChangingNip(true);
              }}
              onFound={onCompanyFound}
            />
          )}

          {step === 'form' && company && (
          <>
          <p className="lead">Kilka podstawowych danych, wystarczą przybliżone wartości.</p>
          <CompanyBar company={company} onChangeNip={() => setChangingNip(true)} />

          <div className="row3">
            <NumberField {...field('kh')} label="Klienci – pełna księgowość" placeholder="np. 100" />
            <NumberField {...field('kpir')} label="Klienci – KPiR / ryczałt" placeholder="np. 200" />
            <NumberField {...field('prac')} label="Liczba pracowników" placeholder="np. 9" />
          </div>

          <div className="group">
            <p className="group-title">Dane z publicznego sprawozdania finansowego</p>
            <p className="group-sub">
              Jeśli są już wpisane, pochodzą z ostatniego opublikowanego sprawozdania. Popraw je, jeśli coś się
              zmieniło.
            </p>
            <div className="row2">
              <NumberField {...field('przychod')} label="Przychód roczny" placeholder="np. 2 000 000" unit="zł/rok" />
              <NumberField
                {...field('koszty')}
                label="Wynagrodzenia z narzutami"
                placeholder="np. 1 200 000"
                unit="zł/rok"
              />
            </div>
          </div>

          <details className="group">
            <summary>Doprecyzuj założenia (opcjonalnie)</summary>
            <p className="group-sub">
              Wpisaliśmy typowe wartości dla biur rachunkowych. Zmień je, jeśli u Ciebie wygląda to inaczej.
            </p>
            <div className="row3">
              <NumberField
                {...field('ef')}
                label="Czas na pracę z klientami"
                unit="%"
                min={1}
                max={100}
                hint="część czasu pracy poświęcana dokumentom i klientom"
              />
              <NumberField
                {...field('wspCzas')}
                label="Czas obsługi KH vs KPiR"
                unit="× więcej"
                min={0.1}
                step={0.1}
                hint="ile razy dłużej trwa obsługa pełnej księgowości"
              />
              <NumberField
                {...field('wspCena')}
                label="Cena KH vs KPiR"
                unit="× więcej"
                min={0.1}
                step={0.1}
                hint="ile razy droższa jest pełna księgowość"
              />
            </div>
          </details>

          {!view.revealed && dataComplete && (
            <div className="waiting" role="status">
              <span className="dot" />
              <span>Dziękuję! Twój rozmówca przygotowuje wynik…</span>
            </div>
          )}

          {view.revealed && !view.result && (
            <div className="waiting" role="status">
              <span className="dot" />
              <span>Uzupełnij dane powyżej, a wynik pojawi się tutaj.</span>
            </div>
          )}

          {view.revealed && view.result && (
            <ResultCard result={view.result} mixKh={mixKh} reply={reply} onMix={setMix} onReply={setReply} />
          )}
          </>
          )}
        </div>
      </div>
    </main>
  );
}

interface ResultProps {
  result: GuestResult;
  mixKh: number | null;
  reply: string;
  onMix: (kh: number) => void;
  onReply: (text: string) => void;
}

function ResultCard({ result, mixKh, reply, onMix, onReply }: ResultProps) {
  const mix = pickMix(result, mixKh);

  return (
    <div className="reveal">
      <p className="reveal-eyebrow">Twój wynik</p>
      <div className="big">{nf(result.godzinyDoOdzyskania)} godzin miesięcznie do odzyskania</div>
      <p>
        Czy wiesz, że wystarczy oszczędzić ok. <b>{nf(result.minutyKhMies)} minut miesięcznie</b> na każdym kliencie z
        pełną księgowością (to ok. <b>{minSec(result.minutyKhDzien)} dziennie</b>) i ok.{' '}
        <b>{nf(result.minutyKpirMies)} minut</b> na kliencie KPiR/ryczałt?
      </p>

      <div className="kpis">
        <div className="kpi">
          <b>{nf(result.godzinyDoOdzyskania)} h</b>
          <small>czasu Twojego zespołu co miesiąc</small>
        </div>
        <div className="kpi">
          <b>
            +{mix.kh} KH + {mix.kpir} KPiR
          </b>
          <small>nowych klientów w tym czasie</small>
        </div>
        <div className="kpi">
          <b>{mix.przychodMies !== null ? `+${zl(mix.przychodMies)}` : zl(result.wartoscCzasuMies)}</b>
          <small>{result.hasPrice ? 'potencjalnego przychodu / mies.' : 'wartości czasu / mies.'}</small>
        </div>
      </div>

      <div className="mix">
        <p>Przesuń suwak i zobacz, jaki miks nowych klientów zmieści się w odzyskanym czasie:</p>
        <input
          type="range"
          min={0}
          max={result.maksNowychKh}
          step={1}
          value={mix.kh}
          onChange={(e) => onMix(Number(e.target.value))}
          aria-label="Miks nowych klientów: od samych klientów KPiR do samych klientów pełnej księgowości"
        />
        <div className="ends">
          <span>tylko KPiR / ryczałt</span>
          <span>tylko pełna księgowość</span>
        </div>
      </div>

      <p>
        Tyle nowych klientów obsłużysz przy obecnym zespole, bez zatrudniania kolejnej osoby. Ja zajmę się
        efektywnością, a Ty możesz skupić się na pozyskiwaniu klientów.
      </p>
      <label className="q" htmlFor="guest-reply">
        Co musiałbyś wiedzieć, żebyśmy mogli przejść do wdrożenia tego rozwiązania u Ciebie?
      </label>
      <textarea
        id="guest-reply"
        value={reply}
        maxLength={2000}
        placeholder="Napisz, co przychodzi Ci do głowy…"
        onChange={(e) => onReply(e.target.value)}
      />
    </div>
  );
}
