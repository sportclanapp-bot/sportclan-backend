import { supabase } from './supabase';
/**
 * SC-413 · ONE rule for "does this match count toward a user's record".
 *
 * The bug: the profile header showed 0 MATCHES while the 90-day panel showed 1 —
 * a window claiming more than a lifetime. Neither screen was at fault. The two
 * numbers were computed from different sources under different rules:
 *
 *   header  = SUM(user_sport_profiles.matches_played), maintained by
 *             completeMatch, which applies the SC-283 anti-farm rule
 *   90-day  = COUNT(match_participants ⋈ completed matches), which applied
 *             NO such rule
 *
 * Prod verdict on the offending match: `real_participants = 1` and the user had
 * no `user_sport_profiles` rows at all — so SC-283 correctly excluded it and the
 * RECAP was the wrong side. A solo-vs-phantom match (free-text opponent, one
 * real participant) contributes nothing to your record, and must not appear in a
 * recap either.
 *
 * The rule now lives HERE and nowhere else, so the two can no longer drift.
 * matches_played is deliberately untouched — it was already correct.
 */

/** Minimal shape needed to judge a match. */
export interface CountableMatch {
  is_ranked?: boolean | null;
  status?: string | null;
}

/**
 * SC-283, stated once.
 *
 * - Ranked matches always count: they are team-based and rated, so there is no
 *   phantom-opponent hole to farm.
 * - Casual matches count only with **≥2 real participants**. `match_participants`
 *   rows are always real user_ids — a free-text "opponent" name contributes no
 *   row — so solo-vs-phantom lands at 1 and is structurally excluded.
 *
 * `participantCount` must be the number of real `match_participants` rows.
 */
export function countsTowardRecord(
  match: CountableMatch | null | undefined,
  participantCount: number,
): boolean {
  if (!match) return false;
  if (match.status !== 'completed') return false;
  if (match.is_ranked) return true;
  return participantCount >= 2;
}

/** Minimum real participants for a casual match to count. Exported so tests and
 *  callers assert against the rule rather than re-typing the literal. */
export const MIN_CASUAL_PARTICIPANTS = 2;

/**
 * SC-413 · real participant counts for a set of matches, in one round trip.
 * `match_participants` rows are always real user_ids, so the row count IS the
 * "real participants" figure the rule needs.
 *
 * On a query error this returns an EMPTY map, which makes casual matches count
 * as 0 participants and therefore be excluded. That is the safe direction: a
 * transient failure understates a record rather than inventing matches.
 */
export async function countParticipantsByMatch(matchIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!matchIds.length) return out;
  const unique = Array.from(new Set(matchIds));
  const { data, error } = await supabase
    .from('match_participants')
    .select('match_id')
    .in('match_id', unique);
  if (error || !data) return out;
  for (const r of data as { match_id: string }[]) {
    out.set(r.match_id, (out.get(r.match_id) ?? 0) + 1);
  }
  return out;
}
