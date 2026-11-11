// Odczyt stanu dostaw sesji (leady i wysyłki) — wspólny dla `guest-session` (widok rozmówcy) i `request-calculation`.
// Dwa proste zapytania zamiast osadzeń PostgREST; samo podsumowanie robi czysta funkcja z src/cta.
import { summarizeDeliveries, type DeliveryRow, type LeadRow } from '../../../src/cta/deliverySummary.ts';
import type { DeliverySummary } from '../../../src/cta/ctaPolicy.ts';
import { admin } from './admin.ts';

export async function loadDeliverySummary(sessionId: string): Promise<DeliverySummary> {
  const { data: leads, error: leadsError } = await admin.from('leads').select('id, email').eq('session_id', sessionId);
  if (leadsError) throw leadsError;
  if (!leads || leads.length === 0) return summarizeDeliveries([], []);

  const { data: deliveries, error: deliveriesError } = await admin
    .from('lead_deliveries')
    .select('id, lead_id, status, created_at')
    .in(
      'lead_id',
      leads.map((l) => l.id),
    );
  if (deliveriesError) throw deliveriesError;

  return summarizeDeliveries(leads as LeadRow[], (deliveries ?? []) as DeliveryRow[]);
}
