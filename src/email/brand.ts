/**
 * Marka organizacji w mailu (`organizations.brand`, jsonb). Dane pochodzą z bazy, ale edytuje je właściciel
 * organizacji, więc traktujemy je jak wejście niezaufane: z każdego pola zostaje tylko to, co przejdzie walidację.
 */
import { parseEmail } from './address.ts';

export interface OrgBrand {
  /** Adres obrazu logo — tylko https. */
  logoUrl?: string;
  /** Kolor główny, #rrggbb. */
  primaryColor?: string;
  /** Nazwa nadawcy widoczna w skrzynce odbiorcy. */
  senderName?: string;
  /** Adres nadawcy; w MailerSend musi należeć do zweryfikowanej domeny. */
  senderEmail?: string;
  /** Strona organizacji ze zgodami (landing page) — tylko https. */
  landingUrl?: string;
}

const MAX_URL_LENGTH = 500;
const MAX_NAME_LENGTH = 100;
// eslint-disable-next-line no-control-regex
const CONTROL_OR_ANGLE = /[\u0000-\u001f\u007f<>"]/u;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Adres https bez danych logowania w URL-u; zwraca znormalizowany URL albo null. */
export function parseHttpsUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname === '' || url.username !== '' || url.password !== '') return null;
  return url.href;
}

/** Nazwa wyświetlana: jedna linia, bez znaków sterujących, `<`, `>` i cudzysłowu (MailerSend ich nie przyjmuje). */
export function parseDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name === '' || name.length > MAX_NAME_LENGTH || CONTROL_OR_ANGLE.test(name)) return null;
  return name;
}

export function parseBrand(raw: unknown): OrgBrand {
  const brand: OrgBrand = {};
  if (!isRecord(raw)) return brand;
  const own = (key: string): unknown => (Object.hasOwn(raw, key) ? raw[key] : undefined);

  const logoUrl = parseHttpsUrl(own('logoUrl'));
  if (logoUrl) brand.logoUrl = logoUrl;

  const color = own('primaryColor');
  if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color.trim())) brand.primaryColor = color.trim().toLowerCase();

  const senderName = parseDisplayName(own('senderName'));
  if (senderName) brand.senderName = senderName;

  const senderEmail = parseEmail(own('senderEmail'));
  if (senderEmail) brand.senderEmail = senderEmail;

  const landingUrl = parseHttpsUrl(own('landingUrl'));
  if (landingUrl) brand.landingUrl = landingUrl;

  return brand;
}
