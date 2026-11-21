/**
 * Q32 (Dipak, 21 Nov 2026, A) · N-R6-E065 / F119 part b: while an offline venue hub runs for a
 * tournament (its hub lease is held: SC-433), every other phone is read-only for that tournament's
 * results — it can still view. Only the hub's own phone (the lease's person AND device) records:
 * scoring points, typing a score, completing, deciding, editing or deleting an action. A hub that
 * has gone quiet in a field without signal is still running (that is its point); another organiser
 * takes it over deliberately (Venue hub › Take over) to record from their phone.
 */
import { getHubLease } from './hubLease';
import { supabase } from './supabase';

export const HUB_RUNNING = 'HUB_RUNNING';

/** The hub lease's holder when it isn't this (person, device): who runs the hub, for the words. */
export async function hubHolderElsewhere(
  tournamentId: string | null | undefined, userId: string, deviceId?: string | null,
): Promise<{ user_id: string; name: string | null } | null> {
  if (!tournamentId) return null;
  const lease = await getHubLease(tournamentId);
  if (!lease) return null;
  if (lease.user_id === userId && !!deviceId && lease.device_id === deviceId) return null;
  const { data } = await supabase.from('users').select('name').eq('id', lease.user_id).maybeSingle();
  return { user_id: lease.user_id, name: (data as { name?: string | null } | null)?.name ?? null };
}

/** The 409 words, one wording for every write path. */
export function hubRefusalBody(holder: { user_id: string; name: string | null }, userId: string): { error: string; code: string } {
  const whose = holder.user_id === userId ? 'your other phone' : holder.name ? `${holder.name}’s phone` : 'another phone';
  return {
    error: `The venue hub on ${whose} is recording this tournament’s results, so this phone can only view them. Record the result on the hub phone, or take the hub over from the tournament’s Venue hub.`,
    code: HUB_RUNNING,
  };
}

/** Null when this phone may record this tournament's results; else the 409 body. */
export async function hubRefusal(
  tournamentId: string | null | undefined, userId: string, deviceId?: string | null,
): Promise<{ error: string; code: string } | null> {
  const holder = await hubHolderElsewhere(tournamentId, userId, deviceId);
  return holder ? hubRefusalBody(holder, userId) : null;
}
