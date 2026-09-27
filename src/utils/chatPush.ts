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
import { testUserIdSet } from './testContent';

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

/**
 * Who a chat message may push to — every rule in one place, so each is tested:
 * never the sender; nobody who left (the caller passes current members only);
 * nobody blocked either way; no deleted account; a test account's message never
 * reaches a real account (B03 — the test flag); then the Chat messages switch
 * and per-chat mute (`prefs`).
 */
export async function pushRecipients(
  o: { senderId: string; memberIds: string[]; blocked: Set<string>; deleted: Set<string>; flagged: Set<string> },
  prefs: (ids: string[]) => Promise<string[]>,
): Promise<string[]> {
  const senderIsTest = o.flagged.has(o.senderId);
  const ids = o.memberIds.filter((u) =>
    u !== o.senderId
    && !o.blocked.has(u)
    && !o.deleted.has(u)
    && (!senderIsTest || o.flagged.has(u)));
  return ids.length ? prefs(ids) : [];
}

export async function pushChatMessage(chatId: string, senderId: string, senderName: string, text: string): Promise<void> {
  try {
    const [{ data: chat }, { data: members }] = await Promise.all([
      supabase.from('chats').select('is_group, name, deleted_at').eq('id', chatId).maybeSingle(),
      // Current members only — someone who left (left_at set) gets nothing.
      supabase.from('chat_participants').select('user_id').eq('chat_id', chatId).is('left_at', null),
    ]);
    // A deleted chat pushes nothing (sendMessage already refuses one; this
    // holds even if called from elsewhere).
    if (!chat || (chat as { deleted_at?: string | null }).deleted_at) return;
    const memberIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
    const [blocked, deleted, flagged] = await Promise.all([
      blockedUserIds(senderId), // either direction (utils/blocks.ts)
      deletedIdSet(memberIds),
      testUserIdSet([senderId, ...memberIds]),
    ]);
    const ids = await pushRecipients({ senderId, memberIds, blocked, deleted, flagged }, (x) =>
      allowedRecipients(x, 'chat_message', { chatId }));
    const due = dueForPush(chatId, ids);
    if (due.length === 0) return;
    if (ids.length === 0) return;
    // chats has is_group (migration 005), not `type` — selecting `type` made the
    // query fail, so no chat push was ever sent (Phase 3 B09-F1).
    const c = chat as { is_group?: boolean | null; name?: string | null };
    const { title, body } = chatPushText({ isGroup: !!c.is_group, chatName: c.name ?? null, senderName, text });
    await sendPushToUsers(due.map((userId) => ({
      userId, type: 'chat_message', title, body, data: { chatId, screen: 'ChatRoom' },
    })));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[chat-push] failed', err instanceof Error ? err.message : err);
  }
}
