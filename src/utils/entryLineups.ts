/**
 * Badminton gap 7 (Oct 2026) · in a singles or doubles event the line-up of a
 * fixture is its entries' players — nobody has to "Add players". Filled for
 * every fixture whose sides are known and that has nobody on that side yet:
 * at the draw, and when a winner moves on to the next round. A tournament
 * entered by teams is left alone (captains pick their line-ups, as before).
 */
import { supabase } from './supabase';

export async function fillEntryLineups(tournamentId: string): Promise<number> {
  try {
    const { data: t } = await supabase.from('tournaments').select('entry_kind').eq('id', tournamentId).maybeSingle();
    const kind = (t as { entry_kind?: string } | null)?.entry_kind;
    if (kind !== 'singles' && kind !== 'doubles') return 0;
    const { data: ms } = await supabase.from('matches').select('id, team_a_id, team_b_id, status')
      .eq('tournament_id', tournamentId).in('status', ['scheduled', 'live']).is('voided_at', null);
    const matches = ((ms ?? []) as Array<{ id: string; team_a_id: string | null; team_b_id: string | null }>).filter((m) => m.team_a_id || m.team_b_id);
    if (matches.length === 0) return 0;
    const [{ data: parts }, { data: mem }] = await Promise.all([
      supabase.from('match_participants').select('match_id, team_side').in('match_id', matches.map((m) => m.id)),
      supabase.from('team_members').select('team_id, user_id, role')
        .in('team_id', [...new Set(matches.flatMap((m) => [m.team_a_id, m.team_b_id]).filter(Boolean) as string[])]),
    ]);
    const has = new Set(((parts ?? []) as Array<{ match_id: string; team_side: string }>).map((p) => `${p.match_id}:${p.team_side}`));
    const playersOf = new Map<string, string[]>();
    // The captain (the one who entered, or invited) first: "player 1" of the pair.
    const sorted = ((mem ?? []) as Array<{ team_id: string; user_id: string; role: string }>).sort((a, b) => (a.role === 'captain' ? -1 : 0) - (b.role === 'captain' ? -1 : 0));
    for (const r of sorted) playersOf.set(r.team_id, [...(playersOf.get(r.team_id) ?? []), r.user_id]);
    const rows: Array<{ match_id: string; user_id: string; team_side: 'A' | 'B' }> = [];
    for (const m of matches) {
      for (const [side, team] of [['A', m.team_a_id], ['B', m.team_b_id]] as const) {
        if (!team || has.has(`${m.id}:${side}`)) continue;
        for (const u of playersOf.get(team) ?? []) rows.push({ match_id: m.id, user_id: u, team_side: side });
      }
    }
    if (rows.length === 0) return 0;
    await supabase.from('match_participants').upsert(rows, { onConflict: 'match_id,user_id' });
    return rows.length;
  } catch {
    return 0; // best-effort: "Add players" still works by hand
  }
}

/** The sports whose rules take players: 2 for a doubles event. */
export function doublesRulesSport(slug: string | null | undefined): boolean {
  return slug === 'badminton' || slug === 'pickleball' || slug === 'tennis';
}
