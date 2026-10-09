/**
 * Stage 11 follow-up · a tie's trump picks (match_tie_trumps, migration 137):
 * each side's one match that counts double for it. Read only by the tie's own
 * endpoints, the score rebuild, typed scores, the timeline and Match Detail once
 * the tie has started — a side's pick is hidden from the other side until both
 * orders are in, like the orders.
 */
import { supabase } from './supabase';

export type TrumpPicks = Partial<Record<'A' | 'B', string>>;

/** The picks for a match, or null when none. */
export async function trumpsFor(matchId: string): Promise<TrumpPicks | null> {
  const { data } = await supabase.from('match_tie_trumps').select('team_side, rubber_key').eq('match_id', matchId);
  const out: TrumpPicks = {};
  for (const r of (data ?? []) as Array<{ team_side: 'A' | 'B'; rubber_key: string }>) out[r.team_side] = r.rubber_key;
  return Object.keys(out).length ? out : null;
}

/** A side picks (or changes) its trump. */
export async function setTrump(matchId: string, side: 'A' | 'B', key: string, userId: string): Promise<boolean> {
  const { error } = await supabase.from('match_tie_trumps').upsert({ match_id: matchId, team_side: side, rubber_key: key, picked_by: userId, picked_at: new Date().toISOString() }, { onConflict: 'match_id,team_side' });
  return !error;
}

/** Whether a match's rules have a trump tie (cheap, no read when they don't). */
export const hasTrump = (rules: unknown): boolean => !!(rules && typeof rules === 'object' && (rules as { tie?: { trump?: unknown } }).tie?.trump === true);
