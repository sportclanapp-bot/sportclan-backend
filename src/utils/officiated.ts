/**
 * Phase 3 · decision 4: umpires get an officiated count.
 *
 * Completed, not voided, with this person as the umpire — the same rule the
 * match-history "officiated" count uses, so the profile number and the list
 * behind it cannot disagree.
 *
 * N-R7-455 (SIDE-A15-3): the history lists a match once — played wins over
 * officiated when both are true, and a bye is not a match — so a match this
 * person umpired AND played in (or a bye) is not counted here either. The
 * profile said 'Officiated 3 matches' over a history 'Played 1 · Officiated 2'.
 */
import { supabase } from './supabase';
import { allRows, selectAllIn } from './selectAll';
import { isByeMatch } from './matchCounts';

export async function officiatedCount(userId: string): Promise<number> {
  try {
    const umpired = await allRows<{ id: string; team_a_id: string | null; team_b_id: string | null; tournament_id: string | null; team_a_name: string | null; team_b_name: string | null }>(() =>
      supabase
        .from('matches')
        .select('id, team_a_id, team_b_id, tournament_id, team_a_name, team_b_name')
        .eq('umpire_id', userId)
        .eq('status', 'completed')
        .is('voided_at', null));
    const ids = umpired.filter((m) => !isByeMatch(m as any)).map((m) => m.id);
    if (ids.length === 0) return 0;
    const played = await selectAllIn<{ match_id: string }>(ids, (c, from, to) =>
      supabase.from('match_participants').select('match_id').eq('user_id', userId).in('match_id', c)
        .order('match_id', { ascending: true }).range(from, to));
    const playedIds = new Set(played.map((p) => p.match_id));
    return ids.filter((id) => !playedIds.has(id)).length;
  } catch {
    return 0;
  }
}
