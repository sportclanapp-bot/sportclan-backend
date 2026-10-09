/**
 * Stage 8 · F8 (Oct 2026) · what a table's ladder needs beyond its matches:
 * fair-play points from the cards (read only when the tie-break order uses
 * them) and the draw of lots the organiser recorded for each group ('' for a
 * one-table tournament). `extraFor(groupLabel)` hands rankTeams its part.
 */
import { supabase } from './supabase';
import { selectAllIn } from './selectAll';
import { fairPlayPoints, type CardEvent } from './fairPlay';
import { settingsOf, tiebreakToken } from './tournamentSettings';
import type { RankExtra } from './standings';

export const usesFairPlay = (rules: unknown): boolean =>
  Array.isArray(rules) && rules.some((r) => tiebreakToken(r) === 'fair_play');

/** Stage 12 · CH1: the order uses the average rating of opponents. */
export const usesRatings = (rules: unknown): boolean =>
  Array.isArray(rules) && rules.some((r) => tiebreakToken(r) === 'aro');

export async function rankExtrasFor(
  t: { settings?: unknown; tiebreaker_rules?: unknown; sport_id?: unknown },
  matches: Array<{ id: string; team_a_id?: string | null; team_b_id?: string | null }>,
): Promise<(group?: string | null) => RankExtra> {
  let fairPlay: Map<string, number> | undefined;
  if (usesFairPlay(t.tiebreaker_rules) && matches.length) {
    const evs = await selectAllIn(matches.map((m) => m.id), (c, f, to) => supabase.from('match_events').select('id, match_id, payload').eq('event_type', 'card').in('match_id', c).order('id').range(f, to));
    fairPlay = fairPlayPoints((evs ?? []) as CardEvent[], new Map(matches.map((m) => [m.id, { A: m.team_a_id ?? null, B: m.team_b_id ?? null }])));
  }
  // Stage 12 · CH1: each entry's rating in the sport (a team's: its members' average) for
  // the average rating of opponents. The app's own rating, as it is now; no rating = unrated.
  let ratings: Map<string, number> | undefined;
  if (usesRatings(t.tiebreaker_rules) && typeof t.sport_id === 'string' && matches.length) {
    const teamIds = [...new Set(matches.flatMap((m) => [m.team_a_id, m.team_b_id]).filter((x): x is string => !!x))];
    const members = (await selectAllIn(teamIds, (c, f, to) => supabase.from('team_members').select('team_id, user_id').in('team_id', c).order('id').range(f, to))) as Array<{ team_id: string; user_id: string }>;
    const users = [...new Set(members.map((m) => m.user_id))];
    const profs = users.length ? ((await selectAllIn(users, (c, f, to) => supabase.from('user_sport_profiles').select('user_id, rating').eq('sport_id', t.sport_id as string).in('user_id', c).order('user_id').range(f, to))) as Array<{ user_id: string; rating: number | null }>) : [];
    const rOf = new Map(profs.filter((p) => p.rating != null).map((p) => [p.user_id, Number(p.rating)]));
    ratings = new Map();
    for (const id of teamIds) {
      const rs = members.filter((m) => m.team_id === id).map((m) => rOf.get(m.user_id)).filter((x): x is number => x != null);
      if (rs.length) ratings.set(id, rs.reduce((a, b) => a + b, 0) / rs.length);
    }
  }
  const lots = settingsOf(t as { settings?: unknown }).lots ?? {};
  return (group) => ({ ...(fairPlay ? { fairPlay } : {}), ...(ratings ? { ratings } : {}), ...(lots[group ?? ''] ? { lots: lots[group ?? ''] } : {}) });
}
