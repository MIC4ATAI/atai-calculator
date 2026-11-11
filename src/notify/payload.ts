/**
 * Powiadomienie dla konsultanta: wiersz z RPC `claim_notifications` → ładunek webhooka n8n.
 *
 * Decyzja produktowa: MINIMUM + link. Do n8n (infrastruktura operatora) nie trafiają nazwa firmy, NIP, adres e-mail
 * klienta ani wartości z kalkulacji — tylko rodzaj zdarzenia, organizacja, imię konsultanta, adresat i link do widoku
 * prezentera (wymaga logowania). Test pilnuje dokładnego zestawu pól.
 */
import { NOTIFY_CHANNELS, type NotifyChannel } from './target.ts';

export type NotificationKind = 'client_returned' | 'client_changed';

/** Wiersz zwracany przez claim_notifications (zwalidowany). */
export interface ClaimedNotification {
  id: number;
  kind: NotificationKind;
  newVisit: boolean;
  createdAt: string;
  sessionId: string;
  organization: string;
  consultantName: string | null;
  channel: NotifyChannel | null;
  target: string | null;
  changedFields: number | null;
}

export interface NotificationPayload {
  eventId: string;
  kind: NotificationKind;
  newVisit: boolean;
  occurredAt: string;
  organization: string;
  consultantName: string | null;
  /** Link do widoku follow-up w aplikacji (wymaga logowania konsultanta). */
  sessionUrl: string;
  changedFields: number | null;
  /** Gotowy tekst alertu po polsku — bez danych klienta; n8n może go wysłać bez żadnej obróbki. */
  message: string;
  channel: { type: NotifyChannel; target: string };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRow(raw: unknown): ClaimedNotification | null {
  if (!isRecord(raw)) return null;
  const { id, kind, new_visit, created_at, session_id, organization, consultant_name, notify_channel, notify_target, changed_fields } = raw;

  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
  if (kind !== 'client_returned' && kind !== 'client_changed') return null;
  if (typeof new_visit !== 'boolean') return null;
  if (typeof created_at !== 'string' || Number.isNaN(Date.parse(created_at))) return null;
  if (typeof session_id !== 'string' || !UUID.test(session_id)) return null;
  if (typeof organization !== 'string' || organization === '') return null;
  if (consultant_name !== null && typeof consultant_name !== 'string') return null;
  if (changed_fields !== null && changed_fields !== undefined && (typeof changed_fields !== 'number' || !Number.isInteger(changed_fields) || changed_fields < 0)) {
    return null;
  }

  // Brak adresata jest dozwolony (wpis zostanie pominięty); niepoprawny kanał lub połowa pary — nie.
  const hasChannel = notify_channel !== null && notify_channel !== undefined;
  const hasTarget = notify_target !== null && notify_target !== undefined;
  if (hasChannel !== hasTarget) return null;
  if (hasChannel && (typeof notify_channel !== 'string' || !(NOTIFY_CHANNELS as readonly string[]).includes(notify_channel))) return null;
  if (hasTarget && typeof notify_target !== 'string') return null;

  return {
    id,
    kind,
    newVisit: new_visit,
    createdAt: created_at,
    sessionId: session_id,
    organization,
    consultantName: consultant_name ?? null,
    channel: hasChannel ? (notify_channel as NotifyChannel) : null,
    target: hasTarget ? (notify_target as string) : null,
    changedFields: typeof changed_fields === 'number' ? changed_fields : null,
  };
}

/** Wynik RPC (tablica JSON) → poprawne wiersze; niepoprawne są pomijane, `invalid` mówi ile. */
export function parseClaimed(raw: unknown): { rows: ClaimedNotification[]; invalid: number } {
  if (!Array.isArray(raw)) return { rows: [], invalid: 0 };
  const rows: ClaimedNotification[] = [];
  let invalid = 0;
  for (const item of raw) {
    const row = parseRow(item);
    if (row) rows.push(row);
    else invalid += 1;
  }
  return { rows, invalid };
}

function messageFor(row: ClaimedNotification): string {
  const fields =
    row.changedFields && row.changedFields > 0
      ? ` (zmienione pola: ${row.changedFields})`
      : '';
  if (row.kind === 'client_returned') return `Klient wrócił do kalkulacji z rozmowy. Zobacz, co ogląda.`;
  return row.newVisit
    ? `Klient wrócił do kalkulacji i zmienił dane${fields}.`
    : `Klient zmienił dane w kalkulacji${fields}.`;
}

/** Wiersz → ładunek webhooka; null, gdy konsultant nie ma adresata (wtedy wpis zamykamy jako pominięty). */
export function buildNotification(row: ClaimedNotification, appBaseUrl: string): NotificationPayload | null {
  if (!row.channel || !row.target) return null;
  return {
    eventId: `ntf-${row.id}`,
    kind: row.kind,
    newVisit: row.newVisit,
    occurredAt: row.createdAt,
    organization: row.organization,
    consultantName: row.consultantName,
    sessionUrl: `${appBaseUrl.replace(/\/+$/, '')}/session/${row.sessionId}/follow-up`,
    changedFields: row.kind === 'client_changed' ? row.changedFields : null,
    message: `${row.organization}: ${messageFor(row)}`,
    channel: { type: row.channel, target: row.target },
  };
}
