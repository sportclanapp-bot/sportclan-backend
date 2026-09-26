/**
 * B13 (V066, D18 — decided 27 Sep 2026) · a push when someone messages you.
 *
 * There was none: apart from an @mention, a new DM or group message reached
 * nobody until they opened Chats. Now each other current member gets a push,
 * with three limits:
 *   - push only, no notifications row — a chat is its own inbox, and a busy
 *     group would bury everything else in the bell;
 *   - "Chat messages" off (notification_preferences.chat = false) means none;
 *   - at most one push per chat per person every QUIET_MS, so a lively group
 *     buzzes once, not on every line.
 * Best-effort and fire-and-forget: a failure never touches the send.
 */
import { supabase } from './supabase';
import { allowedRecipients, sendPushToUsers } from './notify';
import { blockedUserIds } from './blocks';
import { deletedIdSet } from './activeUser';

export const QUIET_MS = 2 * 60 * 1000;
const lastPush = new Map<string, number>(); // `${chatId}:${userId}` → ms

/** Who still needs a push now (and marks them), given the quiet window. */
export function dueForPush(chatId: string, userIds: string[], now = Date.now()): string[] {
  const due: string[] = [];
  for (const u of userIds) {
    const k = `${chatId}:${u}`;
    const last = lastPush.get(k);
    if (last != null && now - last < QUIET_MS) continue;
    lastPush.set(k, now);
    due.push(u);
  }
  if (lastPush.size > 20000) lastPush.clear(); // bounded; worst case one extra push
  return due;
}

/** "Priya: see you at 6" for a group; the text alone for a DM (the title is the sender). */
export function chatPushText(o: { isGroup: boolean; chatName: string | null; senderName: string; text: string }): { title: string; body: string } {
  const text = o.text.replace(/\s+/g, ' ').trim();
  const preview = text.length > 90 ? `${text.slice(0, 89)}…` : text;
  return o.isGroup
    ? { title: o.chatName?.trim() || 'Group chat', body: `${o.senderName}: ${preview}` }
    : { title: o.senderName, body: preview };
}

export async function pushChatMessage(chatId: string, senderId: string, senderName: string, text: string): Promise<void> {
  try {
    const [{ data: chat }, { data: members }] = await Promise.all([
      supabase.from('chats').select('type, name').eq('id', chatId).maybeSingle(),
      supabase.from('chat_participants').select('user_id').eq('chat_id', chatId).is('left_at', null),
    ]);
    let ids = (members ?? []).map((m: { user_id: string }) => m.user_id).filter((u) => u !== senderId);
    if (ids.length === 0) return;
    const blocked = await blockedUserIds(senderId);
    const deleted = await deletedIdSet(ids);
    ids = ids.filter((u) => !blocked.has(u) && !deleted.has(u));
    ids = await allowedRecipients(ids, 'chat_message');
    ids = dueForPush(chatId, ids);
    if (ids.length === 0) return;
    const c = chat as { type?: string; name?: string | null } | null;
    const { title, body } = chatPushText({ isGroup: c?.type !== 'dm', chatName: c?.name ?? null, senderName, text });
    await sendPushToUsers(ids.map((userId) => ({
      userId, type: 'chat_message', title, body, data: { chatId, screen: 'ChatRoom' },
    })));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[chat-push] failed', err instanceof Error ? err.message : err);
  }
}
