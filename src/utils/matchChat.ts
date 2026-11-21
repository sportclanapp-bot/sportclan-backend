/**
 * Q38 (Dipak, 21 Nov 2026: A) · N-R6-E131: a match's chat holds exactly the people in the match,
 * like a tournament's chat (tournamentChat.ts, D7): its creator (admin), its umpire and scorer, and
 * every player in its line-up (members). Nobody adds, removes, promotes, leaves or deletes it by hand;
 * people come and go with the match. Two players who blocked each other both stay in (as in
 * tournament chats). Membership is recomputed, not patched: every trigger runs one idempotent sync.
 */
import { joinChat, leaveChat } from './chatMembership';
import { planChatSync, type ChatAudience } from './tournamentChat';
import { supabase } from './supabase';

export const MATCH_CHAT = {
  error: 'This is a match’s chat. Its members follow the match: the organiser, the officials and the players.',
  code: 'MATCH_CHAT',
} as const;
export const MATCH_LEAVE = {
  error: 'You can’t leave a match’s chat while you’re in the match. Mute it instead.',
  code: 'MATCH_CHAT',
} as const;

/** The match whose chat this is, or null. */
export async function matchOfChat(chatId: string): Promise<string | null> {
  const { data } = await supabase.from('matches').select('id').eq('chat_id', chatId).limit(1);
  return ((data ?? [])[0] as { id?: string } | undefined)?.id ?? null;
}

/** Who belongs in the match's chat; null if a read failed (a sync never removes on a failed read). */
export async function matchChatAudience(matchId: string): Promise<(ChatAudience & { chatId: string | null }) | null> {
  const [mRes, pRes] = await Promise.all([
    supabase.from('matches').select('chat_id, created_by, umpire_id, scorer_id').eq('id', matchId).maybeSingle(),
    supabase.from('match_participants').select('user_id').eq('match_id', matchId),
  ]);
  if (mRes.error || pRes.error || !mRes.data) return null;
  const m = mRes.data as { chat_id?: string | null; created_by?: string | null; umpire_id?: string | null; scorer_id?: string | null };
  const organisers = new Set<string>(m.created_by ? [m.created_by] : []);
  const players = new Set<string>();
  for (const u of [m.umpire_id, m.scorer_id]) if (u) players.add(u);
  for (const r of (pRes.data ?? []) as Array<{ user_id: string | null }>) if (r.user_id) players.add(r.user_id);
  // A deleted account isn't in anyone's chat.
  const all = [...new Set([...organisers, ...players])];
  if (all.length > 0) {
    const { data: gone, error } = await supabase.from('users').select('id').in('id', all).not('deleted_at', 'is', null);
    if (error) return null;
    for (const g of (gone ?? []) as Array<{ id: string }>) { organisers.delete(g.id); players.delete(g.id); }
  }
  return { organisers, players, chatId: m.chat_id ?? null };
}

/** Make the match's chat (if it has one) equal its people. Best-effort; never throws. */
export async function syncMatchChatMembers(matchId: string): Promise<{ added: number; removed: number } | null> {
  try {
    const audience = await matchChatAudience(matchId);
    if (!audience || !audience.chatId) return null;
    const chatId = audience.chatId;
    const { data: current, error } = await supabase
      .from('chat_participants').select('user_id, role').is('left_at', null).eq('chat_id', chatId);
    if (error) return null;
    const plan = planChatSync(audience, (current ?? []) as Array<{ user_id: string; role: string }>);
    // byAdmin: the match decides, so someone once removed by hand comes back while they are in it.
    if (plan.add.length > 0) await joinChat(chatId, plan.add, { byAdmin: true });
    if (plan.promote.length > 0) await supabase.from('chat_participants').update({ role: 'admin' }).eq('chat_id', chatId).in('user_id', plan.promote);
    if (plan.demote.length > 0) await supabase.from('chat_participants').update({ role: 'member' }).eq('chat_id', chatId).in('user_id', plan.demote);
    if (plan.remove.length > 0) await leaveChat(chatId, plan.remove); // 098: a soft leave
    return { added: plan.add.length, removed: plan.remove.length };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[match-chat] sync failed', matchId, e instanceof Error ? e.message : e);
    return null;
  }
}
