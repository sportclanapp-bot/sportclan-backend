import { supabase } from './supabase';

/** U-13: is `userId` someone who could be in this match's line-up? */
export async function viewerCanPlay(
  match: { team_a_id?: string | null; team_b_id?: string | null; umpire_id?: string | null },
  userId: string | undefined,
  participantIds: string[],
): Promise<boolean> {
  if (!userId || match.umpire_id === userId) return false;
  if (participantIds.includes(userId)) return true;
  const teamIds = [match.team_a_id, match.team_b_id].filter(Boolean) as string[];
  if (teamIds.length === 0) return false;
  const { data } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
    .in('team_id', teamIds)
    .limit(1);
  return (data ?? []).length > 0;
}
