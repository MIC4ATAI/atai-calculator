import type { CalcParams } from '../calc/calculator';
import type { Json } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { resolveParams, sanitizeInputs, type SessionInputs } from './guestView';
import { toSessionStatus, type SessionStatus } from './sessionFormat';

/** Pełny stan sesji widoczny dla konsultanta (RLS: własne sesje). */
export interface PresenterRow {
  id: string;
  token: string;
  status: SessionStatus;
  revealed: boolean;
  createdAt: string;
  inputs: SessionInputs;
  /** Ciche założenia sesji (z wartościami wbudowanymi tam, gdzie sesja nic nie nadpisuje). */
  params: CalcParams;
  mixKh: number | null;
  reply: string;
}

/** Kształt wiersza z bazy i z payloadu Realtime (postgres_changes). */
export interface RawSessionRow {
  id: string;
  token: string;
  status: string;
  revealed: boolean;
  created_at: string;
  inputs: unknown;
  params: unknown;
  mix_kh: number | null;
  reply: string;
}

const COLUMNS = 'id, token, status, revealed, created_at, inputs, params, mix_kh, reply';

export function toPresenterRow(raw: RawSessionRow): PresenterRow {
  return {
    id: raw.id,
    token: raw.token,
    status: toSessionStatus(raw.status),
    revealed: raw.revealed,
    createdAt: raw.created_at,
    inputs: sanitizeInputs(raw.inputs),
    params: resolveParams(raw.params),
    mixKh: raw.mix_kh,
    reply: raw.reply,
  };
}

export async function loadPresenterRow(id: string): Promise<PresenterRow | null> {
  const { data, error } = await supabase.from('calc_sessions').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toPresenterRow(data) : null;
}

/** Dopisuje dane do sesji (merge po stronie bazy — nie nadpisuje pól wpisanych równolegle przez rozmówcę). */
export async function patchSessionInputs(id: string, patch: SessionInputs): Promise<void> {
  const { error } = await supabase.rpc('patch_calc_session_inputs', { p_session_id: id, p_patch: patch as Json });
  if (error) throw error;
}

export interface SessionUpdate {
  params?: CalcParams;
  mix_kh?: number | null;
  revealed?: boolean;
}

export async function updateSession(id: string, fields: SessionUpdate): Promise<void> {
  const { params, ...rest } = fields;
  const { error } = await supabase
    .from('calc_sessions')
    .update(params ? { ...rest, params: params as unknown as NonNullable<Json> } : rest)
    .eq('id', id);
  if (error) throw error;
}
