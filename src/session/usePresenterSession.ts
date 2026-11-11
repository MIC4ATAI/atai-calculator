import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalcParams } from '../calc/calculator';
import type { CompanyView } from '../company/companyView';
import type { LeadInfo } from '../cta/leadInfo';
import { supabase } from '../lib/supabase';
import { EXAMPLE_INPUTS, FIELD_ORDER } from './fields';
import type { GuestInputKey, InputValue, SessionInputs } from './guestView';
import {
  loadCompany,
  loadLeadInfo,
  loadPresenterRow,
  patchSessionInputs,
  toPresenterRow,
  updateSession,
  type PresenterRow,
  type RawSessionRow,
  type SessionUpdate,
} from './presenterApi';

export type PresenterStatus = 'loading' | 'ready' | 'missing' | 'error';

/** Zmiany konsultanta zapisane lokalnie, a jeszcze niepotwierdzone przez bazę. */
interface Pending {
  inputs: SessionInputs;
  params: Partial<CalcParams>;
  mixKh?: number;
}

const EMPTY: Pending = { inputs: {}, params: {} };
const hasPending = (p: Pending) =>
  Object.keys(p.inputs).length > 0 || Object.keys(p.params).length > 0 || p.mixKh !== undefined;

const DEBOUNCE_MS = 350;
const RETRY_MS = 3000;
/** Zmiana pola w tym czasie po własnym zapisie nie jest „rozmówca wpisuje…”. */
const LOCAL_ECHO_MS = 1500;

export interface Flash {
  key: GuestInputKey;
  n: number;
}

/**
 * Stan sesji po stronie konsultanta: odczyt przez RLS, zmiany rozmówcy na żywo przez Realtime
 * (postgres_changes), a własne zmiany — natychmiast lokalnie i z opóźnieniem do bazy.
 */
export function usePresenterSession(id: string) {
  const [row, setRow] = useState<PresenterRow | null>(null);
  const [status, setStatus] = useState<PresenterStatus>('loading');
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState<Pending>(EMPTY);
  const [pendingRevealed, setPendingRevealed] = useState<boolean | undefined>(undefined);
  const [typing, setTyping] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [company, setCompany] = useState<CompanyView | null>(null);
  const [leadInfo, setLeadInfo] = useState<LeadInfo | null>(null);

  const rowRef = useRef<PresenterRow | null>(null);
  const pendingRef = useRef<Pending>(EMPTY);
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const flushTimer = useRef<number | undefined>(undefined);
  const lastLocalWrite = useRef(0);
  const prevInputs = useRef<SessionInputs | null>(null);
  const typingTimer = useRef<number | undefined>(undefined);
  const flashTimer = useRef<number | undefined>(undefined);
  const flashCounter = useRef(0);

  useEffect(() => {
    rowRef.current = row;
  }, [row]);

  const refresh = useCallback(async () => {
    try {
      const loaded = await loadPresenterRow(id);
      if (!loaded) {
        setStatus('missing');
        return;
      }
      setRow(loaded);
      setStatus('ready');
      setOffline(false);
    } catch {
      if (rowRef.current) setOffline(true);
      else setStatus('error');
    }
  }, [id]);

  const flush = useCallback(async (): Promise<void> => {
    if (inFlight.current) {
      dirty.current = true;
      return;
    }
    const snapshot = pendingRef.current;
    const base = rowRef.current;
    if (!hasPending(snapshot) || !base) return;

    inFlight.current = true;
    let ok = true;
    try {
      if (Object.keys(snapshot.inputs).length > 0) await patchSessionInputs(id, snapshot.inputs);
      const fields: SessionUpdate = {};
      if (Object.keys(snapshot.params).length > 0) fields.params = { ...base.params, ...snapshot.params };
      if (snapshot.mixKh !== undefined) fields.mix_kh = snapshot.mixKh;
      if (Object.keys(fields).length > 0) await updateSession(id, fields);
    } catch {
      ok = false;
    }
    inFlight.current = false;

    if (ok) {
      setRow((r) =>
        r && {
          ...r,
          inputs: { ...r.inputs, ...snapshot.inputs },
          params: { ...r.params, ...snapshot.params },
          mixKh: snapshot.mixKh !== undefined ? snapshot.mixKh : r.mixKh,
        },
      );
      // Zdejmujemy z „oczekujących” tylko to, czego nie zdążono w międzyczasie zmienić.
      const current = pendingRef.current;
      const inputs: SessionInputs = { ...current.inputs };
      for (const key of Object.keys(snapshot.inputs) as GuestInputKey[]) {
        if (current.inputs[key] === snapshot.inputs[key]) delete inputs[key];
      }
      const params: Partial<CalcParams> = { ...current.params };
      for (const key of Object.keys(snapshot.params) as (keyof CalcParams)[]) {
        if (current.params[key] === snapshot.params[key]) delete params[key];
      }
      const next: Pending = {
        inputs,
        params,
        mixKh: current.mixKh === snapshot.mixKh ? undefined : current.mixKh,
      };
      pendingRef.current = next;
      setPending(next);
      setOffline(false);
    } else {
      setOffline(true);
      window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(() => void flush(), RETRY_MS);
    }

    if (dirty.current) {
      dirty.current = false;
      void flush();
    }
  }, [id]);

  const queue = useCallback(
    (update: (p: Pending) => Pending, delay = DEBOUNCE_MS) => {
      lastLocalWrite.current = Date.now();
      pendingRef.current = update(pendingRef.current);
      setPending(pendingRef.current);
      window.clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(() => void flush(), delay);
    },
    [flush],
  );

  const setInput = useCallback(
    (key: GuestInputKey, value: InputValue) => queue((p) => ({ ...p, inputs: { ...p.inputs, [key]: value } })),
    [queue],
  );

  /** Ciche założenia: tylko dodatnie liczby (jak w prototypie); niepoprawne wpisy ignorujemy. */
  const setParam = useCallback(
    (key: keyof CalcParams, value: number) => {
      if (!Number.isFinite(value) || value <= 0) return;
      queue((p) => ({ ...p, params: { ...p.params, [key]: value } }));
    },
    [queue],
  );

  const setMix = useCallback((kh: number) => queue((p) => ({ ...p, mixKh: kh }), 200), [queue]);

  const fillExample = useCallback(() => queue((p) => ({ ...p, inputs: { ...p.inputs, ...EXAMPLE_INPUTS } }), 0), [queue]);

  const setRevealed = useCallback(
    async (value: boolean) => {
      setPendingRevealed(value);
      try {
        await updateSession(id, { revealed: value });
        setRow((r) => r && { ...r, revealed: value });
        setOffline(false);
      } catch {
        setOffline(true);
      }
      setPendingRevealed(undefined);
    },
    [id],
  );

  // Wczytanie + Realtime: zmiany wiersza (rozmówca wpisuje przez funkcję, konsultant przez RLS).
  useEffect(() => {
    let active = true;
    void refresh();

    const channel = supabase
      .channel(`presenter:${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'calc_sessions', filter: `id=eq.${id}` },
        (payload) => {
          if (active) setRow(toPresenterRow(payload.new as RawSessionRow));
        },
      )
      .subscribe((state) => {
        if (state === 'SUBSCRIBED' && active) void refresh();
      });

    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.clearTimeout(flushTimer.current);
      window.clearTimeout(typingTimer.current);
      window.clearTimeout(flashTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [id, refresh]);

  // Podświetlenie zmienionego pola i status „rozmówca wpisuje…” (gdy zmiana nie pochodzi od nas).
  const serverInputs = row?.inputs;
  useEffect(() => {
    if (!serverInputs) return;
    const previous = prevInputs.current;
    prevInputs.current = serverInputs;
    if (!previous) return;

    const changed = FIELD_ORDER.filter((k) => previous[k] !== serverInputs[k]);
    const last = changed[changed.length - 1];
    if (!last) return;

    flashCounter.current += 1;
    setFlash({ key: last, n: flashCounter.current });
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1300);

    if (Date.now() - lastLocalWrite.current > LOCAL_ECHO_MS) {
      setTyping(true);
      window.clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(() => setTyping(false), 1800);
    }
  }, [serverInputs]);

  // Firma rozmówcy: ładujemy, gdy sesja ją dostaje lub zmienia (Realtime przysyła nowe company_id).
  const companyId = row?.companyId ?? null;
  useEffect(() => {
    if (!companyId) {
      setCompany(null);
      return;
    }
    let active = true;
    loadCompany(companyId)
      .then((c) => active && setCompany(c))
      .catch(() => active && setOffline(true));
    return () => {
      active = false;
    };
  }, [companyId]);

  // Stan CTA (zamrożenie, adres, wysyłki, błąd): raz przy otwarciu, a potem po zmianach sesji (trigger w bazie dotyka
  // sesji po utworzeniu leada i po każdej próbie wysyłki). Zmiany czekają 600 ms, żeby nie odpytywać przy każdym wpisie.
  const updatedAt = row?.updatedAt;
  const revealedOnServer = row?.revealed ?? false;
  const leadLoadedOnce = useRef(false);
  useEffect(() => {
    if (!updatedAt) return;
    if (leadLoadedOnce.current && !revealedOnServer) return; // CTA jest możliwe dopiero po odsłonięciu wyniku
    const timer = window.setTimeout(
      () => {
        leadLoadedOnce.current = true;
        loadLeadInfo(id)
          .then(setLeadInfo)
          .catch(() => setOffline(true));
      },
      leadLoadedOnce.current ? 600 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [id, updatedAt, revealedOnServer]);

  const inputs = useMemo<SessionInputs>(() => ({ ...row?.inputs, ...pending.inputs }), [row, pending.inputs]);
  const params = useMemo<CalcParams | null>(
    () => (row ? { ...row.params, ...pending.params } : null),
    [row, pending.params],
  );
  const mixKh = pending.mixKh !== undefined ? pending.mixKh : (row?.mixKh ?? null);
  const revealed = pendingRevealed ?? row?.revealed ?? false;

  return {
    status,
    offline,
    row,
    company,
    leadInfo,
    inputs,
    params,
    mixKh,
    revealed,
    typing,
    flash,
    setInput,
    setParam,
    setMix,
    setRevealed,
    fillExample,
  };
}
