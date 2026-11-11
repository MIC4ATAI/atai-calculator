/**
 * Informacja o leadzie dla prezentera (konsultanta): kiedy zamrożono stan, na jaki adres i ile razy wysłano
 * kalkulację, czy ostatnia próba się nie powiodła. Dane czyta RLS (konsultant widzi leady swoich sesji).
 */
import { summarizeDeliveries, type LeadRow } from './deliverySummary.ts';

export interface LeadRowWithTime extends LeadRow {
  created_at: string;
}

export interface DeliveryRowWithError {
  id: number;
  lead_id: string;
  status: string;
  error: string | null;
  created_at: string;
}

export interface LeadInfo {
  /** Moment zamrożenia stanu (snapshot); null, gdy rozmówca jeszcze nie poprosił o kalkulację. */
  frozenAt: string | null;
  /** Adres ostatniej próby (też nieudanej) — pomaga zobaczyć literówkę. */
  currentEmail: string | null;
  /** Adres zablokowany po pierwszej udanej wysyłce. */
  lockedEmail: string | null;
  sentCount: number;
  lastSentAt: string | null;
  /** Ostatnia próba, jeśli się nie powiodła (i jest nowsza niż ostatnia udana). */
  lastFailure: { error: string | null; at: string } | null;
}

export function buildLeadInfo(frozenAt: string | null, leads: LeadRowWithTime[], deliveries: DeliveryRowWithError[]): LeadInfo {
  const summary = summarizeDeliveries(leads, deliveries);

  const latestLead = [...leads].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).at(-1);
  const latestDelivery = [...deliveries].sort((a, b) => a.id - b.id).at(-1);
  const lastFailure =
    latestDelivery && latestDelivery.status === 'failed' ? { error: latestDelivery.error, at: latestDelivery.created_at } : null;

  return {
    frozenAt,
    currentEmail: latestLead?.email ?? null,
    lockedEmail: summary.lockedEmail,
    sentCount: summary.sentCount,
    lastSentAt: summary.lastSentAt,
    lastFailure,
  };
}
