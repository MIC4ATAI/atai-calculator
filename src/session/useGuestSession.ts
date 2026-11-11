import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { callGuest, type GuestCallResult } from './guestApi';
import type { GuestInputKey, GuestView, InputValue, SessionInputs } from './guestView';

export type GuestStatus = 'loading' | 'ready' | 'not_found' | 'error';

/** Zmiany wpisane lokalnie, a jeszcze niepotwierdzone przez serwer. Wyświetlamy je ponad stanem z serwera. */
interface Pending {
  inputs: SessionInputs;
  mixKh?: number;
  reply?: string;
}

const EMPTY: Pending = { inputs: {} };
const hasPending = (p: Pending) => Object.keys(p.inputs).length > 0 || p.mixKh !== undefined || p.reply !== undefined;

const INPUT_DEBOUNCE_MS = 300;
const MIX_DEBOUNCE_MS = 200;
const REPLY_DEBOUNCE_MS = 500;
const RETRY_MS = 3000;

/**
 * Stan sesji po stronie rozmówcy: odczyt i zapis przez funkcję `guest-session`, odświeżanie
 * na ping Realtime (kanał session:<token>). Wpisy rozmówcy są natychmiast widoczne lokalnie,
 * a na serwer idą z krótkim opóźnieniem, po kolei.
 */
export function useGuestSession(token: string) {
  const [view, setView] = useState<GuestView | null>(null);
  const [status, setStatus] = useState<GuestStatus>('loading');
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState<Pending>(EMPTY);

  const pendingRef = useRef<Pending>(EMPTY);
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const flushTimer = useRef<number | undefined>(undefined);
  const refreshTimer = useRef<number | undefined>(undefined);
  const hasViewRef = useRef(false);
  // Pierwsze udane wczytanie i każdy powrót do karty zgłaszamy serwerowi jako „wizytę” (powrót po zamrożeniu stanu).
  // Odświeżenia z Realtime ani ponowienia po błędzie wizyty nie tworzą.
  const visitPending = useRef(true);

  const handleFailure = useCallback((kind: 'not_found' | 'unavailable') => {
    if (kind === 'not_found') {
      setStatus('not_found');
      return;
    }
    setOffline(true);
    if (!hasViewRef.current) setStatus('error');
  }, []);

  const applyView = useCallback((next: GuestView) => {
    hasViewRef.current = true;
    setView(next);
    setStatus('ready');
    setOffline(false);
  }, []);

  const refresh = useCallback(async () => {
    const visit = visitPending.current;
    const r: GuestCallResult = await callGuest(visit ? { action: 'get', token, visit: true } : { action: 'get', token });
    if (!r.ok) return handleFailure(r.kind);
    visitPending.current = false;
    // Własne zmiany w drodze mają pierwszeństwo — po ich zapisie i tak przyjdzie świeży stan.
    if (inFlight.current || hasPending(pendingRef.current)) {
      setOffline(false);
      return;
    }
    applyView(r.view);
  }, [token, handleFailure, applyView]);

  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => void refresh(), 150);
  }, [refresh]);

  const flush = useCallback(async (): Promise<void> => {
    if (inFlight.current) {
      dirty.current = true;
      return;
    }
    const snapshot = pendingRef.current;
    if (!hasPending(snapshot)) return;

    inFlight.current = true;
    const r = await callGuest({
      action: 'patch',
      token,
      patch: snapshot.inputs,
      mixKh: snapshot.mixKh,
      reply: snapshot.reply,
    });
    inFlight.current = false;

    if (r.ok) {
      // Zdejmujemy z „oczekujących” tylko to, czego rozmówca nie zdążył w międzyczasie zmienić.
      const current = pendingRef.current;
      const remaining: SessionInputs = { ...current.inputs };
      for (const key of Object.keys(snapshot.inputs) as GuestInputKey[]) {
        if (current.inputs[key] === snapshot.inputs[key]) delete remaining[key];
      }
      const next: Pending = {
        inputs: remaining,
        mixKh: current.mixKh === snapshot.mixKh ? undefined : current.mixKh,
        reply: current.reply === snapshot.reply ? undefined : current.reply,
      };
      pendingRef.current = next;
      setPending(next);
      applyView(r.view);
    } else if (r.kind === 'not_found') {
      setStatus('not_found');
    } else {
      setOffline(true);
      window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(() => void flush(), RETRY_MS);
    }

    if (dirty.current) {
      dirty.current = false;
      void flush();
    }
  }, [token, applyView]);

  const queue = useCallback(
    (update: (p: Pending) => Pending, delay: number) => {
      pendingRef.current = update(pendingRef.current);
      setPending(pendingRef.current);
      window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(() => void flush(), delay);
    },
    [flush],
  );

  const setField = useCallback(
    (key: GuestInputKey, value: InputValue) =>
      queue((p) => ({ ...p, inputs: { ...p.inputs, [key]: value } }), INPUT_DEBOUNCE_MS),
    [queue],
  );
  const setMix = useCallback((kh: number) => queue((p) => ({ ...p, mixKh: kh }), MIX_DEBOUNCE_MS), [queue]);
  const setReply = useCallback((text: string) => queue((p) => ({ ...p, reply: text }), REPLY_DEBOUNCE_MS), [queue]);

  /**
   * „Wróć do stanu z rozmowy”: serwer przywraca dane i miks ze snapshotu. Niezapisane lokalne wpisy porzucamy
   * (przywrócenie ma je zastąpić), a zapis w drodze dokańczamy najpierw, żeby nie nadpisał przywróconego stanu.
   */
  const restore = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(flushTimer.current);
    pendingRef.current = EMPTY;
    setPending(EMPTY);
    for (let i = 0; i < 100 && inFlight.current; i += 1) await new Promise((r) => setTimeout(r, 50));

    const r = await callGuest({ action: 'restore', token });
    if (r.ok) {
      applyView(r.view);
      return true;
    }
    if (r.kind === 'not_found') setStatus('not_found');
    return false;
  }, [token, applyView]);

  // Pierwsze wczytanie + Realtime: ping „changed” z triggera bazy → odświeżenie widoku.
  useEffect(() => {
    let active = true;
    void refresh();

    const channel = supabase
      .channel(`session:${token}`)
      .on('broadcast', { event: 'changed' }, () => {
        if (active) scheduleRefresh();
      })
      .subscribe((state) => {
        // Po (ponownym) połączeniu mogliśmy coś ominąć.
        if (state === 'SUBSCRIBED' && active) void refresh();
      });

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      visitPending.current = true; // klient wrócił do karty
      void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    // Odzyskanie łączności nie jest powrotem klienta — tylko odświeżenie.
    const onOnline = () => void refresh();
    window.addEventListener('online', onOnline);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.clearTimeout(refreshTimer.current);
      window.clearTimeout(flushTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [token, refresh, scheduleRefresh]);

  const inputs = useMemo<SessionInputs>(() => ({ ...view?.inputs, ...pending.inputs }), [view, pending.inputs]);
  const mixKh = pending.mixKh ?? view?.mixKh ?? null;
  const reply = pending.reply ?? view?.reply ?? '';

  return { status, offline, view, inputs, mixKh, reply, setField, setMix, setReply, refresh, restore };
}
