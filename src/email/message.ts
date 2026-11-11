/**
 * Wiadomość do wysłania i jej złożenie z gotowego szablonu. Czysta logika (Node i Deno); sam transport
 * (HTTP do MailerSend / Mailpita) jest w supabase/functions/_shared/mailer.ts.
 */
import { parseEmail } from './address.ts';
import { parseDisplayName, type OrgBrand } from './brand.ts';
import type { RenderedEmail } from './template.ts';

export interface MailAddress {
  email: string;
  name?: string;
}

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

export interface MailMessage {
  from: MailAddress;
  to: MailAddress;
  replyTo?: MailAddress;
  subject: string;
  html: string;
  text: string;
  attachments: MailAttachment[];
}

export interface BuildMessageArgs {
  rendered: RenderedEmail;
  brand: OrgBrand;
  organizationName: string;
  /** Nadawca awaryjny, gdy organizacja nie ma własnego (zmienna środowiskowa MAIL_FROM_DEFAULT). */
  defaultSender: MailAddress;
  /** Adres rozmówcy — już zwalidowany i znormalizowany (parseEmail). */
  recipient: string;
  /** Odpowiedź trafia do konsultanta; pomijana, gdy brak poprawnego adresu. */
  replyTo?: { email: string; name?: string | null } | null;
  attachment: MailAttachment;
}

/** Składa wiadomość: nadawca z marki organizacji (albo awaryjny), odpowiedź do konsultanta, jeden załącznik. */
export function buildCalculationMessage(args: BuildMessageArgs): MailMessage {
  const to = parseEmail(args.recipient);
  if (!to) throw new Error('Niepoprawny adres odbiorcy');

  const fromName = args.brand.senderName ?? parseDisplayName(args.organizationName) ?? args.defaultSender.name;
  const from: MailAddress = {
    email: args.brand.senderEmail ?? args.defaultSender.email,
    ...(fromName ? { name: fromName } : {}),
  };

  const replyEmail = args.replyTo ? parseEmail(args.replyTo.email) : null;
  const replyName = args.replyTo ? parseDisplayName(args.replyTo.name) : null;
  const replyTo: MailAddress | undefined = replyEmail ? { email: replyEmail, ...(replyName ? { name: replyName } : {}) } : undefined;

  return {
    from,
    to: { email: to },
    ...(replyTo ? { replyTo } : {}),
    subject: args.rendered.subject,
    html: args.rendered.html,
    text: args.rendered.text,
    attachments: [args.attachment],
  };
}
