import { supabase } from '../lib/supabase';
import type { SnapshotRowLike } from './conversation';
import { summarizeVisits, type VisitStat } from './presenterView';
import type { EventRow, VisitRow } from './timeline';

export interface FollowUpData {
  snapshot: SnapshotRowLike;
  events: EventRow[];
  visits: VisitRow[];
}

/** Maksymalna liczba zdarzeń dziennika wczytywanych do osi czasu (po zamrożeniu stanu). */
const MAX_EVENTS = 1000;

/**
 * Dane follow-upu sesji z RLS: snapshot, zdarzenia dziennika po zamrożeniu i wizyty klienta.
 * null = sesja nie ma jeszcze zamrożonego stanu (rozmówca nie poprosił o kalkulację).
 */
export async function loadFollowUpData(sessionId: string): Promise<FollowUpData | null> {
  const snap = await supabase
    .from('calc_snapshots')
    .select('inputs, result, mix, calc_version, created_at')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (snap.error) throw snap.error;
  if (!snap.data) return null;

  const [events, visits] = await Promise.all([
    supabase
      .from('calc_events')
      .select('id, actor, field, old_value, new_value, created_at')
      .eq('session_id', sessionId)
      .gte('created_at', snap.data.created_at)
      .order('id', { ascending: true })
      .limit(MAX_EVENTS),
    supabase
      .from('session_visits')
      .select('id, started_at, last_activity_at, changed')
      .eq('session_id', sessionId)
      .order('started_at', { ascending: true }),
  ]);
  if (events.error) throw events.error;
  if (visits.error) throw visits.error;

  return { snapshot: snap.data, events: events.data ?? [], visits: visits.data ?? [] };
}

/** Liczba wizyt klienta i moment ostatniej dla listy sesji (RLS: widać tylko własne sesje). */
export async function loadVisitStats(sessionIds: string[]): Promise<Map<string, VisitStat>> {
  if (sessionIds.length === 0) return new Map();
  const { data, error } = await supabase.from('session_visits').select('session_id, started_at').in('session_id', sessionIds);
  if (error) throw error;
  return summarizeVisits(data ?? []);
}
