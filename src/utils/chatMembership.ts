/**
 * Soft chat membership (decided 27 Sep 2026 — no hard deletes of user data).
 *
 * Leaving a chat used to DELETE the chat_participants row, and deleting a group
 * DELETEd the chat (cascading its messages). Now (migration 098):
 *   • leaving sets chat_participants.left_at — the row stays;
 *   • rejoining clears left_at on that same row (the (chat_id, user_id) key);
 *   • deleting a group sets chats.deleted_at — the chat and its messages stay.
 *
 * Every membership READ ignores rows with left_at set, and every chat read
 * ignores chats with deleted_at set: someone who left gets no messages, no
 * unread count, no typing, no member-list entry; a deleted group is in no list
 * and takes no messages.
 */
import { supabase } from './supabase';

/** Is this person a CURRENT member of a chat that still exists? */
export async function isActiveMember(chatId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('chat_participants')
    .select('id, chat:chats!inner(deleted_at)')
    .eq('chat_id', chatId)
    .eq('user_id', userId)
    .is('left_at', null)
    .is('chat.deleted_at', null)
    .maybeSingle();
  return !!data;
}

/** The member's row if they are current (role, for admin checks); null otherwise. */
export async function activeMembership(chatId: string, userId: string): Promise<{ role: string } | null> {
  const { data } = await supabase
    .from('chat_participants')
    .select('role, chat:chats!inner(deleted_at)')
    .eq('chat_id', chatId)
    .eq('user_id', userId)
    .is('left_at', null)
    .is('chat.deleted_at', null)
    .maybeSingle();
  return data ? { role: (data as { role: string }).role } : null;
}

/** Leave: mark the row, never delete it. Idempotent. */
export async function leaveChat(chatId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await supabase
    .from('chat_participants')
    .update({ left_at: new Date().toISOString(), typing_until: null })
    .eq('chat_id', chatId)
    .in('user_id', userIds)
    .is('left_at', null);
}

/**
 * Join, or rejoin: a new row, or clear left_at on the old one. An ACTIVE
 * member's row is left alone (so an admin re-added isn't demoted to member).
 */
export async function joinChat(chatId: string, members: Array<{ user_id: string; role: 'admin' | 'member' }>): Promise<void> {
  if (members.length === 0) return;
  const ids = members.map((m) => m.user_id);
  const { data: existing } = await supabase
    .from('chat_participants').select('user_id, left_at').eq('chat_id', chatId).in('user_id', ids);
  const byId = new Map((existing ?? []).map((r) => [r.user_id as string, r.left_at as string | null]));
  const fresh = members.filter((m) => !byId.has(m.user_id));
  const returning = members.filter((m) => byId.has(m.user_id) && byId.get(m.user_id) != null);
  if (fresh.length > 0) {
    await supabase.from('chat_participants').upsert(
      fresh.map((m) => ({ chat_id: chatId, user_id: m.user_id, role: m.role })),
      { onConflict: 'chat_id,user_id', ignoreDuplicates: true },
    );
  }
  for (const m of returning) {
    await supabase
      .from('chat_participants')
      .update({ left_at: null, role: m.role, joined_at: new Date().toISOString() })
      .eq('chat_id', chatId)
      .eq('user_id', m.user_id);
  }
}

/** Soft-delete a chat: it disappears from every list and takes no messages. */
export async function softDeleteChat(chatId: string): Promise<void> {
  await supabase.from('chats').update({ deleted_at: new Date().toISOString() }).eq('id', chatId).is('deleted_at', null);
}
