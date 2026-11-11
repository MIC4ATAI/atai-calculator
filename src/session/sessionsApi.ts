import { supabase } from '../lib/supabase';
import { toSessionStatus, type SessionStatus } from './sessionFormat';

export interface SessionListItem {
  id: string;
  token: string;
  status: SessionStatus;
  revealed: boolean;
  createdAt: string;
  /** Firma rozmówcy (nazwa z GUS lub null) i jej NIP; oba null = rozmówca jeszcze nie podał NIP-u. */
  companyName: string | null;
  companyNip: string | null;
}

interface SessionRow {
  id: string;
  token: string;
  status: string;
  revealed: boolean;
  created_at: string;
  company?: { name: string | null; nip: string } | null;
}

function toItem(row: SessionRow): SessionListItem {
  return {
    id: row.id,
    token: row.token,
    status: toSessionStatus(row.status),
    revealed: row.revealed,
    createdAt: row.created_at,
    companyName: row.company?.name ?? null,
    companyNip: row.company?.nip ?? null,
  };
}

const COLUMNS = 'id, token, status, revealed, created_at, company:companies(name, nip)';

/** Własne sesje konsultanta w wybranej organizacji, od najnowszej. */
export async function listMySessions(orgId: string, userId: string): Promise<SessionListItem[]> {
  const { data, error } = await supabase
    .from('calc_sessions')
    .select(COLUMNS)
    .eq('org_id', orgId)
    .eq('consultant_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map(toItem);
}

/** Tworzy sesję przez RPC (sprawdza członkostwo; trigger zapisuje zdarzenie użycia). */
export async function createSession(orgId: string): Promise<SessionListItem> {
  const { data, error } = await supabase.rpc('create_calc_session', { p_org_id: orgId });
  if (error) throw error;
  return toItem(data);
}

/** Pojedyncza sesja widoczna dla zalogowanej osoby (RLS) albo null. */
export async function getSession(id: string): Promise<SessionListItem | null> {
  const { data, error } = await supabase.from('calc_sessions').select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toItem(data) : null;
}
