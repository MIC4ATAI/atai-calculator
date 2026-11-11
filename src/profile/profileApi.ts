import { NOTIFY_CHANNELS, type NotifyChannel } from '../notify/target';
import { supabase } from '../lib/supabase';

export interface NotificationSettings {
  channel: NotifyChannel | null;
  target: string | null;
}

/** Własny profil (RLS: tylko właściciel go edytuje); brak adresata = powiadomienia wyłączone. */
export async function loadNotificationSettings(userId: string): Promise<NotificationSettings> {
  const { data, error } = await supabase.from('profiles').select('notify_channel, notify_target').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  const channel = (NOTIFY_CHANNELS as readonly string[]).includes(data?.notify_channel ?? '') ? (data!.notify_channel as NotifyChannel) : null;
  return { channel, target: channel ? (data?.notify_target ?? null) : null };
}

/** Zapis przez grant kolumnowy (tylko notify_channel i notify_target); baza sprawdza format i parę pól. */
export async function saveNotificationSettings(userId: string, settings: NotificationSettings): Promise<void> {
  const { data, error } = await supabase
    .from('profiles')
    .update({ notify_channel: settings.channel, notify_target: settings.target })
    .eq('user_id', userId)
    .select('user_id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Profil nie istnieje');
}
