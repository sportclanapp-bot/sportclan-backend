/**
 * Audit #6 (11 Oct 2026): whose record a match result may change.
 *
 * Anyone could create a ranked (or casual) match between two teams they weren't
 * in, put anyone in its line-up, score it and complete it — rewriting those
 * players' rating, wins and losses. A player's record now moves only if they
 * agreed to play:
 *  · a tournament fixture: everyone in its line-up (they entered the tournament);
 *  · otherwise: the match's creator, the creator's own teammates (the registered
 *    team the creator is on, on that team's side), and anyone who answered "In"
 *    (match_availability 'available') for this match.
 * Everyone else stays in the line-up but their record doesn't change.
 */
import { supabase } from './supabase';

type Part = { user_id: string; team_side: string };
type M = { id: string; created_by?: string | null; tournament_id?: string | null; team_a_id?: string | null; team_b_id?: string | null };

export async function consentedParticipants<P extends Part>(match: M, parts: P[]): Promise<P[]> {
  if (match.tournament_id || parts.length === 0) return parts;
  const ids = [...new Set(parts.map((p) => p.user_id))];
  const teamIds = [match.team_a_id, match.team_b_id].filter((x): x is string => !!x);
  const [{ data: avail }, { data: mine }] = await Promise.all([
    supabase.from('match_availability').select('user_id').eq('match_id', match.id).eq('status', 'available').in('user_id', ids),
    match.created_by && teamIds.length
      ? supabase.from('team_members').select('team_id').eq('user_id', match.created_by).in('team_id', teamIds)
      : Promise.resolve({ data: [] as Array<{ team_id: string }> }),
  ]);
  const said = new Set(((avail ?? []) as Array<{ user_id: string }>).map((r) => r.user_id));
  const creatorTeams = ((mine ?? []) as Array<{ team_id: string }>).map((r) => r.team_id);
  const sideOfTeam = (t: string) => (t === match.team_a_id ? 'A' : 'B');
  const rosterSide = new Map<string, Set<string>>();
  if (creatorTeams.length) {
    const { data: roster } = await supabase.from('team_members').select('team_id, user_id').in('team_id', creatorTeams).in('user_id', ids);
    for (const r of (roster ?? []) as Array<{ team_id: string; user_id: string }>) {
      const s = rosterSide.get(r.user_id) ?? new Set<string>();
      s.add(sideOfTeam(r.team_id));
      rosterSide.set(r.user_id, s);
    }
  }
  return parts.filter((p) => p.user_id === match.created_by || said.has(p.user_id) || !!rosterSide.get(p.user_id)?.has(p.team_side));
}

/** Audit #6: is this user on one of these registered teams? */
export async function isOnAnyTeam(userId: string, teamIds: string[]): Promise<boolean> {
  if (!teamIds.length) return false;
  const { data } = await supabase.from('team_members').select('id').eq('user_id', userId).in('team_id', teamIds).limit(1);
  return (data ?? []).length > 0;
}
