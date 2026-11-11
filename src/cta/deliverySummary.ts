/**
 * Podsumowanie dostaw sesji z wierszy tabel `leads` i `lead_deliveries` oraz ochrona przed podwójnym kliknięciem.
 * Czysta logika bez zależności od Excela (importuje ją też `guest-session`, która nie ma mapy importów exceljs).
 */
import type { DeliverySummary } from './ctaPolicy.ts';

export interface LeadRow {
  id: string;
  email: string;
}
export interface DeliveryRow {
  id: number;
  lead_id: string;
  status: string;
  created_at: string;
}

export function summarizeDeliveries(leads: LeadRow[], deliveries: DeliveryRow[]): DeliverySummary {
  const emailByLead = new Map(leads.map((l) => [l.id, l.email]));
  const sent = deliveries.filter((d) => d.status === 'sent' && emailByLead.has(d.lead_id)).sort((a, b) => a.id - b.id);
  const first = sent[0];
  const last = sent[sent.length - 1];
  return {
    hasLead: leads.length > 0,
    sentCount: sent.length,
    lockedEmail: first ? (emailByLead.get(first.lead_id) ?? null) : null,
    lastSentAt: last ? last.created_at : null,
  };
}

/** Okno, w którym identyczna prośba po udanej wysyłce jest traktowana jak podwójne kliknięcie. */
export const DUPLICATE_WINDOW_MS = 10_000;

export function isDuplicateSend(lastSentAt: string | null, nowMs: number, windowMs: number = DUPLICATE_WINDOW_MS): boolean {
  if (!lastSentAt) return false;
  const at = Date.parse(lastSentAt);
  if (Number.isNaN(at)) return false;
  const age = nowMs - at;
  return age >= 0 && age < windowMs;
}
