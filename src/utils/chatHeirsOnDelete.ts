import { supabase } from './supabase';
import { selectAllIn } from './selectAll';

/**
 * N-R6-13 (Round 6): a deleted account stays in its group chats (as 'Deleted User'), but when it
 * was the group's only admin nobody could manage the group any more. Leaving already hands the
 * group to an heir (SC-301: the oldest remaining member); deleting now does the same. Tournament
 * chats are left alone — their admins follow the tournament's organisers (D7, E-128).
 * Best-effort; returns how many groups got a new admin.
 */
export async function handGroupsToHeirsOnDelete(userId: string): Promise<number> {
  const { data: mine } = await supabase
    .from('chat_participants').select('chat_id').is('left_at', null).eq('user_id', userId).eq('role', 'admin');
  const chatIds = [...new Set((mine ?? []).map((r: { chat_id: string }) => r.chat_id))];
  if (!chatIds.length) return 0;
  const groups = await selectAllIn<{ id: string; is_group: boolean | null; deleted_at: string | null }>(chatIds, (c, f, t) =>
    supabase.from('chats').select('id, is_group, deleted_at').in('id', c).order('id').range(f, t));
  let n = 0;
  for (const g of groups) {
    if (!g.is_group || g.deleted_at) continue;
    const { data: t } = await supabase.from('tournaments').select('id').eq('sport_metadata->>_chat_id', g.id).limit(1);
    if ((t ?? []).length) continue;
    const { data: otherAdmins } = await supabase.from('chat_participants').select('user_id')
      .is('left_at', null).eq('chat_id', g.id).eq('role', 'admin').neq('user_id', userId).limit(1);
    if ((otherAdmins ?? []).length) continue;
    const { data: heir } = await supabase.from('chat_participants').select('user_id')
      .is('left_at', null).eq('chat_id', g.id).neq('user_id', userId).order('joined_at', { ascending: true }).limit(1).maybeSingle();
    if (!heir) continue;
    await supabase.from('chat_participants').update({ role: 'admin' }).eq('chat_id', g.id).eq('user_id', (heir as { user_id: string }).user_id);
    n++;
  }
  return n;
}
