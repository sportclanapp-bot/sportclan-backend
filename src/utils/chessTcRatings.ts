/**
 * BUILD 3.71 · chess ratings per time control (migration 115).
 *
 * Beside the overall chess rating (user_sport_profiles, written atomically by
 * finalize_match), each ranked chess game also moves the two players' rating in
 * its time control — bullet / blitz / rapid / classical, the category the clock
 * falls in (matchRules.chessClockLabel). Same Elo engine, same 100 floor.
 *
 * Idempotent: the history row (UNIQUE user_id, match_id) is written first, and
 * only the rows actually inserted move a rating — a replayed completion moves
 * nothing. Voiding walks the history rows back; restoring re-applies them.
 */

import { supabase } from './supabase';
import { calculateElo } from './ratingEngine';
import { chessClockLabel, rulesOf } from './matchRules';

export type TimeControl = 'bullet' | 'blitz' | 'rapid' | 'classical';

/** The time control a chess match is played at, from its rules (or its stored format). */
export function timeControlOf(match: { rules?: unknown; format?: string | null; overs?: number | null }): TimeControl {
  const r = rulesOf('chess', match);
  return chessClockLabel(r.baseMinutes ?? 5, r.incrementSeconds ?? 0).toLowerCase() as TimeControl;
}

interface Line { user_id: string; rating: number; matches_played: number; wins: number; losses: number; draws: number }
const fresh = (uid: string): Line => ({ user_id: uid, rating: 1200, matches_played: 0, wins: 0, losses: 0, draws: 0 });

/**
 * After a ranked one-a-side chess game completes: move both players' rating in
 * its time control. `winner` null = a draw.
 */
export async function recordChessTc(
  match: { id: string; rules?: unknown; format?: string | null; overs?: number | null },
  white: string,
  black: string,
  winner: 'A' | 'B' | null,
): Promise<void> {
  const tc = timeControlOf(match);
  const { data: rows } = await supabase
    .from('user_chess_ratings').select('user_id, rating, matches_played, wins, losses, draws')
    .eq('time_control', tc).in('user_id', [white, black]);
  const by = new Map(((rows ?? []) as Line[]).map((r) => [r.user_id, { ...r, rating: Number(r.rating) }]));
  const w = by.get(white) ?? fresh(white);
  const b = by.get(black) ?? fresh(black);
  const outcome: 1 | 0 | 0.5 = winner === 'A' ? 1 : winner === 'B' ? 0 : 0.5;
  const [ra, rb] = calculateElo(
    { rating: w.rating, matchesPlayed: w.matches_played },
    { rating: b.rating, matchesPlayed: b.matches_played },
    outcome,
  );
  const result = (side: 'A' | 'B') => (winner == null ? 'draw' : winner === side ? 'win' : 'loss');
  const next = (l: Line, delta: number) => Math.max(100, Math.round((l.rating + delta) * 100) / 100);
  const history = [
    { user_id: white, match_id: match.id, time_control: tc, result: result('A'), old_rating: w.rating, new_rating: next(w, ra.delta), delta: next(w, ra.delta) - w.rating },
    { user_id: black, match_id: match.id, time_control: tc, result: result('B'), old_rating: b.rating, new_rating: next(b, rb.delta), delta: next(b, rb.delta) - b.rating },
  ];
  const { data: inserted, error } = await supabase
    .from('chess_rating_history')
    .upsert(history, { onConflict: 'user_id,match_id', ignoreDuplicates: true })
    .select('user_id, result, new_rating');
  if (error) { console.warn('[3.71] chess_rating_history insert failed:', error.message); return; } // eslint-disable-line no-console
  for (const h of (inserted ?? []) as Array<{ user_id: string; result: string; new_rating: number }>) {
    const l = h.user_id === white ? w : b;
    await supabase.from('user_chess_ratings').upsert({
      user_id: h.user_id,
      time_control: tc,
      rating: Number(h.new_rating),
      matches_played: l.matches_played + 1,
      wins: l.wins + (h.result === 'win' ? 1 : 0),
      losses: l.losses + (h.result === 'loss' ? 1 : 0),
      draws: l.draws + (h.result === 'draw' ? 1 : 0),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,time_control' });
  }
}

/** Void (-1) or restore (+1) a chess match's time-control ratings, from its history rows. */
export async function applyChessTcDeltas(matchId: string, sign: 1 | -1): Promise<void> {
  const { data: hist } = await supabase
    .from('chess_rating_history').select('user_id, time_control, result, delta').eq('match_id', matchId);
  for (const h of (hist ?? []) as Array<{ user_id: string; time_control: TimeControl; result: string; delta: number }>) {
    const { data: l } = await supabase
      .from('user_chess_ratings').select('rating, matches_played, wins, losses, draws')
      .eq('user_id', h.user_id).eq('time_control', h.time_control).maybeSingle();
    if (!l) continue;
    const c = (n: number) => (n < 0 ? 0 : n);
    const row = l as Omit<Line, 'user_id'>;
    await supabase.from('user_chess_ratings').update({
      rating: Math.max(100, Math.round((Number(row.rating) + sign * Number(h.delta)) * 100) / 100),
      matches_played: c(row.matches_played + sign),
      wins: c(row.wins + (h.result === 'win' ? sign : 0)),
      losses: c(row.losses + (h.result === 'loss' ? sign : 0)),
      draws: c(row.draws + (h.result === 'draw' ? sign : 0)),
      updated_at: new Date().toISOString(),
    }).eq('user_id', h.user_id).eq('time_control', h.time_control);
  }
}
