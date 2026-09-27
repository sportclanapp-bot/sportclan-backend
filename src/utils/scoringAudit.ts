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
): Promise<{ error?: string; auditId?: string }> {
  const { data: logRow, error: logErr } = await supabase.from('match_event_audit').insert({
    event_id: event.id,
    match_id: event.match_id,
    changed_by: userId,
    old_payload: event, // the whole row: type, payload, side, who scored it, when
    new_payload: {},
    action,
    // Scoring edit log (migration 109): the score just before; the score just
    // after is added by recordScoreAfter once the match is recomputed.
    score_before: await currentScore(event.match_id),
  }).select('id').maybeSingle();
  if (logErr) return { error: 'Could not record this change, so nothing was removed. Try again.' };
  const { error } = await supabase.from('match_events').delete().eq('id', event.id);
  if (error) return { error: error.message };
  return { auditId: (logRow as { id?: string } | null)?.id };
}

/** The match's score as it stands (score_summary), for the edit log. */
export async function currentScore(matchId: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from('matches').select('score_summary').eq('id', matchId).maybeSingle();
  return ((data as { score_summary?: Record<string, unknown> | null } | null)?.score_summary) ?? null;
}

/** Log an edit of an event's payload (old → new), with the score before. */
export async function logEventEdit(args: {
  eventId: string; matchId: string; userId: string;
  oldPayload: Record<string, unknown>; newPayload: Record<string, unknown>; eventType?: string | null;
}): Promise<{ error?: string; auditId?: string }> {
  const { data, error } = await supabase.from('match_event_audit').insert({
    event_id: args.eventId,
    match_id: args.matchId,
    changed_by: args.userId,
    // The type rides along so the log can say "ball 4.3" / "point" later.
    old_payload: { ...args.oldPayload, ...(args.eventType ? { __event_type: args.eventType } : {}) },
    new_payload: args.newPayload,
    action: 'edit',
    score_before: await currentScore(args.matchId),
  }).select('id').maybeSingle();
  if (error) return { error: 'Could not record this change, so nothing was changed. Try again.' };
  return { auditId: (data as { id?: string } | null)?.id };
}

/** The score just after the change, once the match has been recomputed. Best effort. */
export async function recordScoreAfter(auditId: string | undefined, summary: Record<string, unknown> | null): Promise<void> {
  if (!auditId) return;
  try {
    await supabase.from('match_event_audit').update({ score_after: summary ?? null }).eq('id', auditId);
  } catch {
    // the change itself already happened; the log just reads without "→ score"
  }
}
