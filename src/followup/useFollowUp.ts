import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { loadPresenterRow, type PresenterRow } from '../session/presenterApi';
import { loadFollowUpData } from './followUpApi';
import { buildPresenterFollowUp, type PresenterFollowUp } from './presenterView';

export type FollowUpStatus = 'loading' | 'ready' | 'missing' | 'error';

const REFRESH_DEBOUNCE_MS = 500;

/**
 * Dane widoku „rozmowa vs ostatnia symulacja”: sesja i follow-up z RLS, odświeżane na żywo — każda zmiana wiersza
 * sesji (dane klienta, wizyta, wysyłka) przychodzi przez Realtime, a baza „dotyka” sesji także przy nowej wizycie.
 */
export function useFollowUp(id: string) {
  const [status, setStatus] = useState<FollowUpStatus>('loading');
  const [offline, setOffline] = useState(false);
  const [row, setRow] = useState<PresenterRow | null>(null);
  /** null = sesja nie ma zamrożonego stanu albo snapshot jest uszkodzony (rozróżnia `hasSnapshot`). */
  const [followUp, setFollowUp] = useState<PresenterFollowUp | null>(null);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const loaded = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const current = await loadPresenterRow(id);
      if (!current) {
        setStatus('missing');
        return;
      }
      const data = await loadFollowUpData(id);
      setRow(current);
      setHasSnapshot(data !== null);
      setFollowUp(
        data
          ? buildPresenterFollowUp({
              snapshot: data.snapshot,
              inputs: current.inputs,
              params: current.params,
              mixKh: current.mixKh,
              events: data.events,
              visits: data.visits,
            })
          : null,
      );
      loaded.current = true;
      setStatus('ready');
      setOffline(false);
    } catch {
      if (loaded.current) setOffline(true);
      else setStatus('error');
    }
  }, [id]);

  const scheduleLoad = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void load(), REFRESH_DEBOUNCE_MS);
  }, [load]);

  useEffect(() => {
    let active = true;
    void load();

    const channel = supabase
      .channel(`followup:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calc_sessions', filter: `id=eq.${id}` }, () => {
        if (active) scheduleLoad();
      })
      .subscribe((state) => {
        if (state === 'SUBSCRIBED' && active) void load();
      });

    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      active = false;
      window.clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
    };
  }, [id, load, scheduleLoad]);

  return { status, offline, row, followUp, hasSnapshot };
}
