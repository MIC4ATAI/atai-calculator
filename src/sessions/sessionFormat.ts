export type SessionStatus = 'live' | 'shared' | 'archived';

const STATUS_LABELS: Record<SessionStatus, string> = {
  live: 'Na żywo',
  shared: 'Udostępniona',
  archived: 'Zarchiwizowana',
};

/** Status z bazy jest tekstem z ograniczeniem CHECK; nieznaną wartość traktujemy jak „Na żywo”. */
export function toSessionStatus(value: string): SessionStatus {
  return value === 'shared' || value === 'archived' || value === 'live' ? value : 'live';
}

export function statusLabel(status: SessionStatus): string {
  return STATUS_LABELS[status];
}

/** Link dla rozmówcy: otwiera się bez logowania, token jest nieodgadywalny. */
export function guestLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/s/${token}`;
}

const dateTime = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '–' : dateTime.format(d);
}
