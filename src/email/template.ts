/**
 * Mail z kalkulacją, w marce organizacji i podpisany przez konsultanta (spec: „E-mail i zgody”).
 *
 * Mail wysyłamy tylko dlatego, że rozmówca o niego poprosił (Excel + link do sesji). To NIE jest treść reklamowa:
 * zaproszenie na landing page organizacji to krótki dopisek, a zgody zbiera wyłącznie ten landing page.
 *
 * Wszystkie dane dynamiczne (nazwa firmy z GUS, podpis, nazwa organizacji) są escapowane w HTML, a w nagłówkach
 * (temat) sprowadzane do jednej linii.
 */
import { formatNip } from '../company/companyView.ts';
import { nf } from '../session/format.ts';
import type { OrgBrand } from './brand.ts';

/**
 * BRZMIENIE DO POTWIERDZENIA Z PRAWNIKIEM (spec: „Zaproszenie w mailu to krótki dopisek, nie treść reklamowa”).
 * Wstawiane tylko wtedy, gdy organizacja ma `landingUrl`. Nie dołączamy do linku identyfikatora sesji —
 * sposób powiązania zgód z firmą i kalkulacją ustali etap 4 (landing page).
 */
export const LANDING_INVITATION_TEXT =
  'Jeśli chcesz, możesz zostawić nam swoje dane kontaktowe na stronie poniżej — to dobrowolne i niezależne od tej wiadomości.';

/** BRZMIENIE DO POTWIERDZENIA Z PRAWNIKIEM: informacja, dlaczego dostaje tę wiadomość. */
export const ONE_TIME_NOTICE_TEXT =
  'Wysłaliśmy tę wiadomość jednorazowo, w odpowiedzi na prośbę o przesłanie kalkulacji. Nie zawiera treści reklamowych.';

const DEFAULT_ACCENT = '#1f6f5c';
const TEXT_DARK = '#1d2321';

export interface EmailInput {
  organizationName: string;
  brand: OrgBrand;
  consultant: { name: string | null; phone: string | null; signature: string | null };
  company: { name: string | null; nip: string };
  summary: { godzinyDoOdzyskania: number; maksNowychKh: number };
  /** Link do sesji rozmówcy (https; lokalnie dopuszczamy http). */
  sessionUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Pomocnicze
// ---------------------------------------------------------------------------
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Jedna linia bez znaków sterujących i separatorów linii — bezpieczna do nagłówków (temat). */
export function singleLine(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Link do sesji: bezwzględny http(s) bez danych logowania; inaczej błąd (to błąd programisty, nie rozmówcy). */
export function assertSessionUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Niepoprawny adres sesji w mailu');
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '') {
    throw new Error('Niepoprawny adres sesji w mailu');
  }
  return url.href;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** Biały albo ciemny tekst — ten, który ma lepszy kontrast na kolorze marki (WCAG). */
export function readableTextColor(background: string): string {
  const l = luminance(background);
  const contrastWhite = 1.05 / (l + 0.05);
  const contrastDark = (l + 0.05) / (luminance(TEXT_DARK) + 0.05);
  return contrastWhite >= contrastDark ? '#ffffff' : TEXT_DARK;
}

const klienci = (n: number): string => (n === 1 ? 'klient KH' : 'klientów KH');

/** „121 h miesięcznie → +20 klientów KH”. */
export function resultLine(summary: EmailInput['summary']): string {
  return `${nf(summary.godzinyDoOdzyskania)} h miesięcznie → +${summary.maksNowychKh} ${klienci(summary.maksNowychKh)}`;
}

/** Linie podpisu: podpis konsultanta z profilu (do 5 linii) albo imię i nazwisko + organizacja; telefon dopisany, jeśli go brak. */
export function signatureLines(input: Pick<EmailInput, 'consultant' | 'organizationName'>): string[] {
  const fromProfile = (input.consultant.signature ?? '')
    .split(/\r?\n/)
    .map((line) => singleLine(line).slice(0, 120))
    .filter((line) => line !== '')
    .slice(0, 5);
  const lines =
    fromProfile.length > 0
      ? fromProfile
      : [input.consultant.name ? singleLine(input.consultant.name) : '', singleLine(input.organizationName)].filter(Boolean);

  const phone = input.consultant.phone && /^[0-9 +()\-.]{5,30}$/.test(input.consultant.phone) ? input.consultant.phone.trim() : null;
  // Porównujemy końcówkę numeru (bez prefiksu kraju): „+48 600 100 300” i „600-100-300” to ten sam telefon.
  const digits = (s: string) => s.replace(/\D/g, '');
  const tail = phone ? digits(phone).slice(-9) : '';
  if (phone && !lines.some((l) => digits(l).includes(tail))) lines.push(`tel. ${phone}`);
  return lines;
}

function companyPhrase(company: EmailInput['company']): string {
  const nip = `NIP ${formatNip(company.nip)}`;
  return company.name ? `${singleLine(company.name)} (${nip})` : nip;
}

// ---------------------------------------------------------------------------
// Szablon
// ---------------------------------------------------------------------------
export function renderCalculationEmail(input: EmailInput): RenderedEmail {
  const sessionUrl = assertSessionUrl(input.sessionUrl);
  const accent = input.brand.primaryColor ?? DEFAULT_ACCENT;
  const onAccent = readableTextColor(accent);
  const org = singleLine(input.organizationName);
  const subject = `Twoja kalkulacja z rozmowy – ${org}`.slice(0, 150);
  const result = resultLine(input.summary);
  const company = companyPhrase(input.company);
  const signature = signatureLines(input);
  const landing = input.brand.landingUrl ?? null;

  const intro = `W załączniku przesyłamy kalkulację z naszej rozmowy dla firmy ${company}. W pliku Excel znajdziesz wynik z rozmowy oraz zakładkę „Twoja symulacja”, w której możesz samodzielnie zmieniać dane.`;
  const sessionLead = 'Możesz też wrócić do swojej sesji i sprawdzić inne scenariusze:';

  // --- wersja tekstowa ---
  const text = [
    'Dzień dobry,',
    '',
    intro,
    '',
    `Wynik z rozmowy: ${result}`,
    '',
    sessionLead,
    sessionUrl,
    ...(landing ? ['', LANDING_INVITATION_TEXT, landing] : []),
    '',
    'Pozdrawiamy,',
    ...signature,
    '',
    '--',
    ONE_TIME_NOTICE_TEXT,
  ].join('\n');

  // --- wersja HTML (tabele i style inline, żeby działała w klientach pocztowych) ---
  const e = escapeHtml;
  const logo = input.brand.logoUrl
    ? `<img src="${e(input.brand.logoUrl)}" alt="${e(org)}" height="40" style="display:block;border:0;max-height:40px;width:auto;">`
    : `<span style="font-size:18px;font-weight:bold;color:${accent};">${e(org)}</span>`;

  const landingBlock = landing
    ? `<p style="margin:0 0 6px;font-size:14px;color:#444444;">${e(LANDING_INVITATION_TEXT)}</p>
       <p style="margin:0 0 20px;font-size:14px;"><a href="${e(landing)}" style="color:${accent};">${e(landing)}</a></p>`
    : '';

  const html = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f2;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;font-family:Arial,Helvetica,sans-serif;color:${TEXT_DARK};font-size:15px;line-height:1.5;">
<tr><td style="padding:28px 32px 8px;">${logo}</td></tr>
<tr><td style="padding:8px 32px 0;">
<h1 style="margin:0 0 14px;font-size:20px;color:${accent};">Twoja kalkulacja z rozmowy</h1>
<p style="margin:0 0 12px;">Dzień dobry,</p>
<p style="margin:0 0 16px;">${e(intro)}</p>
<div style="margin:0 0 18px;padding:14px 16px;background:#e3f1ec;border-radius:10px;"><strong>Wynik z rozmowy:</strong> ${e(result)}</div>
<p style="margin:0 0 10px;">${e(sessionLead)}</p>
<p style="margin:0 0 8px;"><a href="${e(sessionUrl)}" style="display:inline-block;padding:12px 22px;background:${accent};color:${onAccent};text-decoration:none;border-radius:8px;font-weight:bold;">Otwórz sesję kalkulatora</a></p>
<p style="margin:0 0 20px;font-size:12px;color:#666666;word-break:break-all;">Jeśli przycisk nie działa, skopiuj adres: ${e(sessionUrl)}</p>
${landingBlock}
<p style="margin:0 0 4px;">Pozdrawiamy,</p>
<p style="margin:0 0 24px;">${signature.map(e).join('<br>')}</p>
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #e2e5e0;font-size:12px;color:#777777;">${e(ONE_TIME_NOTICE_TEXT)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}
