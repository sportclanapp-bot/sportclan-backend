/**
 * Hard-delete list #7 (27 Sep 2026) · removing a scoring event is logged first.
 *
 * An undo (POST /scoring/:matchId/undo) and an editor's delete
 * (DELETE /matches/:id/events/:eventId) both remove a ball / point for good —
 * that is what they are for. What must not go is the record of it: who did
 * it, when, and the full event as it was. This writes that row to
 * match_event_audit FIRST and removes the event only if the row was written.
 * (Migration 107 makes the row outlive the event; before it, the log row of a
 * delete was cascaded away with the event it described.)
 */
import { supabase } from './supabase';

export type EventRemoval = 'undo' | 'delete';

/**
 * Log, then delete. `event` is the full match_events row as it was. Returns
 * an error message when the log row could not be written — the event is then
 * left in place.
 */
export async function logThenDeleteEvent(
  event: Record<string, unknown> & { id: string; match_id: string },
  userId: string,
  action: EventRemoval,
): Promise<{ error?: string }> {
  const { error: logErr } = await supabase.from('match_event_audit').insert({
    event_id: event.id,
    match_id: event.match_id,
    changed_by: userId,
    old_payload: event, // the whole row: type, payload, side, who scored it, when
    new_payload: {},
    action,
  });
  if (logErr) return { error: 'Could not record this change, so nothing was removed. Try again.' };
  const { error } = await supabase.from('match_events').delete().eq('id', event.id);
  if (error) return { error: error.message };
  return {};
}
