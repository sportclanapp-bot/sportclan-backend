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

export async function rankExtrasFor(
  t: { settings?: unknown; tiebreaker_rules?: unknown },
  matches: Array<{ id: string; team_a_id?: string | null; team_b_id?: string | null }>,
): Promise<(group?: string | null) => RankExtra> {
  let fairPlay: Map<string, number> | undefined;
  if (usesFairPlay(t.tiebreaker_rules) && matches.length) {
    const evs = await selectAllIn(matches.map((m) => m.id), (c, f, to) => supabase.from('match_events').select('id, match_id, payload').eq('event_type', 'card').in('match_id', c).order('id').range(f, to));
    fairPlay = fairPlayPoints((evs ?? []) as CardEvent[], new Map(matches.map((m) => [m.id, { A: m.team_a_id ?? null, B: m.team_b_id ?? null }])));
  }
  const lots = settingsOf(t as { settings?: unknown }).lots ?? {};
  return (group) => ({ ...(fairPlay ? { fairPlay } : {}), ...(lots[group ?? ''] ? { lots: lots[group ?? ''] } : {}) });
}
