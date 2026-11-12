import { selectAllIn } from './selectAll';
import { supabase } from './supabase';

/**
 * N-R7-S147 (Step 2 B14, X2-229): a deleted account's team_members row is kept (B2-a, a tombstone)
 * but the member list hides it (SC-79), so a plain count of team_members said "11 members" over 10
 * rows. Per team, how many of its member rows belong to a deleted account — usually none, so this
 * is one small read — to take off a database count.
 */
export async function deletedMemberCounts(teamIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (teamIds.length === 0) return out;
  const rows = await selectAllIn<{ team_id: string }>(teamIds, (ids, from, to) => supabase
    .from('team_members')
    .select('id, team_id, user:user_id!inner(deleted_at)')
    .in('team_id', ids)
    .not('user.deleted_at', 'is', null)
    .order('id', { ascending: true })
    .range(from, to));
  for (const r of rows) out.set(r.team_id, (out.get(r.team_id) ?? 0) + 1);
  return out;
}

/** A team row's live member count: the database count less its deleted accounts. */
export function liveCount(total: number | null | undefined, teamId: string, deleted: Map<string, number>): number {
  return Math.max(0, (total ?? 0) - (deleted.get(teamId) ?? 0));
}
