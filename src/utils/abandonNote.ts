/**
 * N-R7-S173 (Step 2 FINAL, SIDE-B17-3): the abandon line in a match's log, for the abandons that
 * no person taps — the sweep of idle live matches, a cancelled tournament, a withdrawal walkover.
 * The pad's Abandon writes the same note (N-R7-120). The app stops the match clock (and chess
 * clocks) at it (N-R7-706/708), so a later 'Replay the rest' doesn't count the time it stood.
 * A note: no score, stat or standings reader counts it. Only for a match that was live — one
 * nobody started has no log. Best-effort: the abandon itself stands.
 */
import { supabase } from './supabase';
import { IN_CHUNK } from './selectAll';

export type AbandonNote = { match_id: string; walkover_side?: 'A' | 'B'; walkover_one?: boolean; reason?: string };

export async function writeAbandonNotes(notes: AbandonNote[], createdBy: string | null): Promise<void> {
  const rows = notes.map(({ match_id, ...p }) => ({
    match_id, event_type: 'note', period: null, clock_seconds: null, created_by: createdBy,
    payload: { kind: 'abandoned', ...(p.reason ? { reason: p.reason } : {}), ...(p.walkover_side ? { walkover_side: p.walkover_side, ...(p.walkover_one ? { walkover_one: true } : {}) } : {}) },
  }));
  for (let i = 0; i < rows.length; i += IN_CHUNK) {
    try {
      const { error } = await supabase.from('match_events').insert(rows.slice(i, i + IN_CHUNK));
      if (error) console.error('abandon note failed:', error.message);
    } catch (e) { console.error('abandon note failed:', e instanceof Error ? e.message : e); }
  }
}
