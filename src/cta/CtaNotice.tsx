import type { CtaNoticeView } from './notice';

/**
 * Klauzula informacyjna RODO przy polu e-mail: treść i link do polityki prywatności organizacji. To informacja,
 * nie zgoda — nie ma tu pola do zaznaczenia. Treść jest zwykłym tekstem (React escapuje ją przy wyświetlaniu).
 */
export function CtaNotice({ notice, id }: { notice: CtaNoticeView; id: string }) {
  return (
    <div id={id} className="privacy-notice" role="note" aria-label="Informacja o przetwarzaniu danych osobowych">
      {notice.paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      {notice.privacyUrl && (
        <p>
          <a href={notice.privacyUrl} target="_blank" rel="noopener noreferrer">
            Polityka prywatności: {notice.organization}
          </a>
        </p>
      )}
    </div>
  );
}
