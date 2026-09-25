/**
 * SC-424 · voiding a match, and the ONE rule for what that means.
 *
 * Before this there were two ways to deal with a match that should never have
 * counted — a test fixture, a mis-scored game, a fixture played under protest.
 * Leave it in everyone's record, or delete rows on prod. The first is a lie; the
 * second destroys the event log, the audit trail and any chance of undoing it.
 *
 * Voiding keeps the match and every event exactly where they are and sets a flag
 * that says "this does not count". The match page says so out loud, every rollup
 * honours it, and clearing the flag puts the match back.
 *
 * DELIBERATELY NOT A STATUS. `status` describes how a match ENDED — completed,
 * abandoned, cancelled — and a voided match still ended however it ended. Two
 * orthogonal facts get two orthogonal columns, and no existing status check has
 * to learn a new value it might forget.
 *
 * TWO HALVES, AND BOTH ARE REQUIRED.
 *  1. Queries that read across matches must exclude voided ones. That is what
 *     `notVoided` is for, and the sweep in SC-424 applied it everywhere.
 *  2. Counters that were already MATERIALISED at completion — user_sport_profiles
 *     (matches_played / wins / losses / draws / rating) — are not queries and
 *     cannot be filtered. They have to be walked back, which is `reverseRecord`.
 */

import { supabase } from './supabase';
import { countsTowardRecord } from './matchCounts';

/** Columns any caller needs to decide and display void state. */
export const VOID_COLUMNS = 'voided_at, voided_by, void_reason';

export interface VoidableMatch {
  voided_at?: string | null;
}

export const isVoided = (m: VoidableMatch | null | undefined): boolean =>
  !!m && m.voided_at != null;

/**
 * Exclude voided matches from a supabase query builder.
 *
 * Written as a helper rather than an inline `.is(...)` so the sweep is greppable:
 * every rollup that counts matches should either call this or be able to say why
 * it does not (a single-match read does not need it — the match page shows the
 * void banner instead of hiding the match).
 *
 * `column` is the path to the match row: 'voided_at' when querying `matches`
 * directly, or '<alias>.voided_at' when it is an embedded `!inner` join.
 */
export function notVoided<T extends { is: (c: string, v: null) => T }>(
  query: T,
  column = 'voided_at',
): T {
  return query.is(column, null);
}

/**
 * SC-441 (M2) · the statuses a voided match must never be LISTED under.
 *
 * SC-424 swept the rollups but not `listMatches`, on the reasoning that a single
 * match page shows the void banner rather than hiding the match. That reasoning
 * does not carry to a LIST: the Sport Hub's "1 LIVE" counter and Home's
 * "FEATURED · LIVE" were both counting and promoting voided matches, with a
 * VOIDED pill on the very same card. A voided match is not live and is not
 * upcoming — whatever its `status` column still says.
 *
 * It must nevertheless stay READABLE from history (decision D2): team match
 * history, a player's own match list and past results all keep showing it, which
 * is why this is a list of PRE-COMPLETION statuses rather than a blanket filter.
 * Ask for 'completed' or 'abandoned', or ask for a specific team's or your own
 * matches, and the voided match is still there with its banner.
 */
// F-24: a match is never 'upcoming' (the column allows scheduled, live, completed,
// cancelled, abandoned); 'upcoming' is a TOURNAMENT status.
export const HIDE_VOIDED_FOR_STATUSES = ['scheduled', 'live'] as const;

/**
 * Should a match list exclude voided rows?
 *
 * `true` only for a discovery-shaped read: a pre-completion status, and not a
 * history read scoped to one team or to yourself.
 */
export function shouldHideVoided(opts: {
  status?: string | null;
  teamScoped?: boolean;
  mine?: boolean;
}): boolean {
  if (opts.teamScoped || opts.mine) return false;
  if (!opts.status) return true; // an unscoped list is discovery
  return (HIDE_VOIDED_FOR_STATUSES as readonly string[]).includes(opts.status);
}

// ─── Walking back what completion already applied ──────────────────────────

interface ProfileDelta {
  user_id: string;
  matches_played: number;
  wins: number;
  losses: number;
  draws: number;
  rating: number;
}

/**
 * What `completeMatch` applied to user_sport_profiles for this match.
 *
 * Mirrors the completion path exactly rather than guessing:
 *  - who: the match's participants (ranked and casual alike)
 *  - whether it counted at all: `countsTowardRecord`, the single rule shared with
 *    the profile header and the 90-day recap — plus the walkover exemption, since
 *    a forfeit applies no attribution
 *  - the rating movement: the `delta` stored on the rating_history row written at
 *    completion. A casual match has no such row, and moved no rating, so 0.
 *
 * Returning the numbers rather than applying them keeps this testable and lets
 * void and unvoid share one calculation with opposite signs.
 */
export async function recordDeltas(matchId: string): Promise<ProfileDelta[]> {
  const { data: match } = await supabase
    .from('matches')
    .select('id, sport_id, status, is_ranked, winner_team_id, team_a_id, team_b_id, score_summary')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return [];

  const { data: parts } = await supabase
    .from('match_participants')
    .select('user_id, team_side')
    .eq('match_id', matchId);
  const participants = parts ?? [];

  // A walkover records a winner without a played game and applies no attribution.
  const walkover = (match.score_summary as { walkover?: boolean } | null)?.walkover === true;
  if (walkover) return [];
  if (!countsTowardRecord(match, participants.length)) return [];

  const { data: history } = await supabase
    .from('rating_history')
    .select('user_id, delta')
    .eq('match_id', matchId);
  const deltaByUser = new Map<string, number>();
  for (const h of history ?? []) deltaByUser.set(h.user_id, Number(h.delta ?? 0));

  // Winning side. Ranked/team matches carry winner_team_id; a casual pickup has
  // free-text sides and records its winner as score_summary.winner_side.
  const ss = (match.score_summary ?? {}) as { winner_side?: 'A' | 'B' | null };
  let winnerSide: 'A' | 'B' | null = ss.winner_side ?? null;
  if (match.winner_team_id) {
    if (match.winner_team_id === match.team_a_id) winnerSide = 'A';
    else if (match.winner_team_id === match.team_b_id) winnerSide = 'B';
  }

  return participants.map((p) => ({
    user_id: p.user_id,
    matches_played: 1,
    wins: winnerSide != null && p.team_side === winnerSide ? 1 : 0,
    losses: winnerSide != null && p.team_side !== winnerSide ? 1 : 0,
    draws: winnerSide == null ? 1 : 0,
    rating: deltaByUser.get(p.user_id) ?? 0,
  }));
}

/**
 * Apply `sign * deltas` to user_sport_profiles: -1 to void, +1 to restore.
 *
 * Read-modify-write per row rather than an RPC, because this is a rare
 * organiser/admin action on one match, not a hot path — and because it has to
 * work on a deploy where no new database function exists yet. Rating is floored
 * at 100, the same floor completion clamps to, and counters are floored at 0 so
 * a double-void can never drive a record negative.
 */
export async function applyRecordDeltas(
  sportId: string,
  deltas: ProfileDelta[],
  sign: 1 | -1,
): Promise<void> {
  for (const d of deltas) {
    const { data: prof } = await supabase
      .from('user_sport_profiles')
      .select('user_id, rating, matches_played, wins, losses, draws')
      .eq('user_id', d.user_id)
      .eq('sport_id', sportId)
      .maybeSingle();
    if (!prof) continue; // nothing was ever materialised for this player

    const clamp0 = (n: number) => (n < 0 ? 0 : n);
    await supabase
      .from('user_sport_profiles')
      .update({
        matches_played: clamp0(prof.matches_played + sign * d.matches_played),
        wins: clamp0(prof.wins + sign * d.wins),
        losses: clamp0(prof.losses + sign * d.losses),
        draws: clamp0(prof.draws + sign * d.draws),
        rating: Math.max(100, Math.round((prof.rating + sign * d.rating) * 100) / 100),
      })
      .eq('user_id', d.user_id)
      .eq('sport_id', sportId);
  }
}
