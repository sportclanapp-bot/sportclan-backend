/**
 * Stage 8 · F8 (Oct 2026) · what a table's ladder needs beyond its matches:
 * fair-play points from the cards (read only when the tie-break order uses
 * them) and the draw of lots the organiser recorded for each group ('' for a
 * one-table tournament). `extraFor(groupLabel)` hands rankTeams its part.
 */
import { supabase } from './supabase';
import { allRows, selectAllIn } from './selectAll';
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
  /** N-R7-338 (SIDE-C1b-1): with the tournament's id, its entries' seeds place teams level on everything. */
  tournamentId?: string | null,
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
  // N-R7-338 (SIDE-C1b-1): the seeds, the last word before the team id (a box nobody has played in yet reads in seed order).
  let seeds: Map<string, number> | undefined;
  if (tournamentId) {
    try {
      const rows = await allRows<{ team_id: string; seed: number | null; entered_at?: string | null }>(() => supabase
        .from('tournament_entries').select('id, team_id, seed, entered_at').eq('tournament_id', tournamentId));
      const m = new Map<string, number>();
      for (const r of rows ?? []) if (r?.team_id && r.seed != null && Number.isFinite(Number(r.seed))) m.set(r.team_id, Number(r.seed));
      // N-R7-348 (SIDE-C2b-1): unseeded entries follow the seeded ones in entry order
      // (P01 entered before P02), not in team-id order; no entry time → team id, as before.
      const unseeded = (rows ?? []).filter((r) => r?.team_id && !m.has(r.team_id) && r.entered_at)
        .sort((a, b) => String(a.entered_at).localeCompare(String(b.entered_at)) || (a.team_id < b.team_id ? -1 : a.team_id > b.team_id ? 1 : 0));
      unseeded.forEach((r, i) => { if (!m.has(r.team_id)) m.set(r.team_id, 1e9 + i); });
      if (m.size) seeds = m;
    } catch { /* no seeds: the team id decides, as before */ }
  }
  const lots = settingsOf(t as { settings?: unknown }).lots ?? {};
  return (group) => ({ ...(fairPlay ? { fairPlay } : {}), ...(ratings ? { ratings } : {}), ...(seeds ? { seeds } : {}), ...(lots[group ?? ''] ? { lots: lots[group ?? ''] } : {}) });
}
