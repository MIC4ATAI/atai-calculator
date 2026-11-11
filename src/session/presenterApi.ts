import type { CalcParams } from '../calc/calculator';
import { toCompanyView, type CompanyView } from '../company/companyView';
import { buildLeadInfo, type LeadInfo } from '../cta/leadInfo';
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
  /** Firma przypięta do sesji przez rozmówcę (NIP + dane z GUS); null = jeszcze brak NIP-u. */
  companyId: string | null;
  /** Ostatnia zmiana wiersza — także leada i prób wysyłki (trigger „dotyka” sesji) — wyzwala odświeżenie stanu CTA. */
  updatedAt: string;
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
  company_id: string | null;
  updated_at: string;
}

const COLUMNS = 'id, token, status, revealed, created_at, inputs, params, mix_kh, reply, company_id, updated_at';

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
    companyId: raw.company_id,
    updatedAt: raw.updated_at,
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

/** Firma sesji (RLS: widoczna dla konsultanta tej sesji i dla admina organizacji). */
export async function loadCompany(companyId: string): Promise<CompanyView | null> {
  const { data, error } = await supabase
    .from('companies')
    .select('nip, regon, name, street, building_no, unit_no, postal_code, city, voivodeship, gus_type, gus_status, fetched_at')
    .eq('id', companyId)
    .maybeSingle();
  if (error) throw error;
  return data ? toCompanyView(data) : null;
}

/**
 * Stan CTA sesji dla prezentera: zamrożenie, adres, liczba wysyłek, ostatni błąd. Czyta RLS (leady, dostawy i snapshot
 * widoczne dla konsultanta tej sesji i dla admina organizacji).
 */
export async function loadLeadInfo(sessionId: string): Promise<LeadInfo> {
  const [snapshot, leads] = await Promise.all([
    supabase.from('calc_snapshots').select('created_at').eq('session_id', sessionId).maybeSingle(),
    supabase.from('leads').select('id, email, created_at').eq('session_id', sessionId),
  ]);
  if (snapshot.error) throw snapshot.error;
  if (leads.error) throw leads.error;

  const leadRows = leads.data ?? [];
  let deliveries: { id: number; lead_id: string; status: string; error: string | null; created_at: string }[] = [];
  if (leadRows.length > 0) {
    const res = await supabase
      .from('lead_deliveries')
      .select('id, lead_id, status, error, created_at')
      .in(
        'lead_id',
        leadRows.map((l) => l.id),
      );
    if (res.error) throw res.error;
    deliveries = res.data ?? [];
  }
  return buildLeadInfo(snapshot.data?.created_at ?? null, leadRows, deliveries);
}
