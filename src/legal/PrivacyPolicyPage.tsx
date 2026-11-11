import { useEffect } from 'react';
import { buildPrivacyPolicy, MITAX_POLICY, splitPlaceholders } from './policy';

const policy = buildPrivacyPolicy(MITAX_POLICY);

function Text({ value }: { value: string }) {
  return (
    <>
      {splitPlaceholders(value).map((s, i) =>
        s.placeholder ? (
          <mark key={i} className="policy-placeholder">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Publiczna strona polityki prywatności administratora (dostępna bez logowania). Dopóki treść jest projektem (brakuje danych
 * albo nie zatwierdził jej prawnik), pokazuje ostrzeżenie i prosi wyszukiwarki, by jej nie indeksowały.
 */
export function PrivacyPolicyPage() {
  useEffect(() => {
    if (!policy.isDraft) return;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  return (
    <main className="page policy">
      {policy.isDraft && (
        <div className="policy-draft" role="note">
          <strong>Projekt dokumentu.</strong> Ta treść nie została jeszcze zweryfikowana prawnie i nie jest ostateczną polityką prywatności.
          {policy.missing.length > 0 && <> Brakuje danych: {policy.missing.join('; ')}.</>}
        </div>
      )}
      <h1>{policy.title}</h1>
      <p className="sub">Ostatnia aktualizacja: {policy.updatedAt}</p>
      {policy.sections.map((section) => (
        <section key={section.id} aria-labelledby={`pp-${section.id}`}>
          <h2 id={`pp-${section.id}`}>{section.heading}</h2>
          {section.paragraphs.map((p, i) => (
            <p key={i}>
              <Text value={p} />
            </p>
          ))}
          {section.items && (
            <ul>
              {section.items.map((item, i) => (
                <li key={i}>
                  <Text value={item} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}
