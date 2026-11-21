/**
 * Q43 (Dipak, 21 Nov 2026: B) · Q-R6-8: a tournament's creator deletes their account. Every
 * tournament they created that isn't finished (upcoming or live; its events go with it) passes to
 * the longest-standing co-organiser still on SPORTCLAN (the team rule's "oldest member"), who is
 * told. With no co-organiser, the app admin decides: the tournament goes into the admin queue
 * (Admin › Reports, content_reports target 'tournament', migration 167), where an admin can open
 * it and finish, cancel or hand it on. Best-effort, like the captaincy hand-over beside it.
 */
import { supabase } from './supabase';
import { notifyUsers } from './notify';

export const ADMIN_QUEUE_REASON = 'Organiser deleted their account · no co-organiser';

export async function handTournamentsOnDelete(userId: string): Promise<{ handed: Array<{ id: string; to: string }>; queued: string[] }> {
  const out = { handed: [] as Array<{ id: string; to: string }>, queued: [] as string[] };
  const { data: mine } = await supabase.from('tournaments').select('id, name')
    .eq('created_by', userId).is('parent_id', null).in('status', ['upcoming', 'live']);
  for (const t of (mine ?? []) as Array<{ id: string; name: string | null }>) {
    const { data: orgs } = await supabase.from('tournament_organisers')
      .select('user_id, created_at')
      .eq('tournament_id', t.id).neq('user_id', userId)
      .order('created_at', { ascending: true }).order('user_id', { ascending: true });
    const ids = ((orgs ?? []) as Array<{ user_id: string }>).map((o) => o.user_id);
    const { data: live } = ids.length
      ? await supabase.from('users').select('id').in('id', ids).is('deleted_at', null)
      : { data: [] as Array<{ id: string }> };
    const liveIds = new Set(((live ?? []) as Array<{ id: string }>).map((u) => u.id));
    const heir = ids.find((id) => liveIds.has(id));
    if (heir) {
      // The tournament and its events (badminton gap 1: events carry parent_id).
      await supabase.from('tournaments').update({ created_by: heir }).eq('id', t.id).eq('created_by', userId);
      await supabase.from('tournaments').update({ created_by: heir }).eq('parent_id', t.id).eq('created_by', userId);
      out.handed.push({ id: t.id, to: heir });
      await notifyUsers([heir], {
        type: 'tournament_updated',
        title: 'You now run this tournament',
        body: `${t.name ?? 'A tournament'}: its organiser deleted their account, so it passed to you as its longest-standing co-organiser.`,
        data: { tournamentId: t.id },
      });
      continue;
    }
    const { data: open } = await supabase.from('content_reports').select('id')
      .eq('target_type', 'tournament').eq('target_id', t.id).eq('resolved', false).limit(1);
    if ((open ?? []).length === 0) {
      const { error } = await supabase.from('content_reports')
        .insert({ target_type: 'tournament', target_id: t.id, reporter_id: userId, reason: ADMIN_QUEUE_REASON, resolved: false });
      if (error) continue;
    }
    out.queued.push(t.id);
  }
  return out;
}
