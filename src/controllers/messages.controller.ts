import { Request, Response } from 'express';
import { selectAllIn } from '../utils/selectAll';
import { isUuid } from '../utils/uuid';
import { supabase } from '../utils/supabase';
import { chunks, IN_CHUNK } from '../utils/inChunks';
import { sanitizeError } from '../utils/response';
import { isBlockedBetween, blockedUserIds, excludeIds } from '../utils/blocks';
import { deletedIdSet } from '../utils/activeUser';
import { LIMITS, firstInvalidUrl, ARRAY_LIMITS, tooManyItems, firstDisallowedImageUrl } from '../utils/validation';
import { parsePagination, pageMeta } from '../utils/pagination';
import { isActiveMember, leaveChat, joinChat, softDeleteChat } from '../utils/chatMembership';
import { pushChatMessage } from '../utils/chatPush';
import { taggableBy } from '../utils/tagPrivacy';

// ─── Phase 3 B09 · shared checks ─────────────────────────────────────────────
/** The app's six reactions (ChatScreens) — nothing else is stored (B09-F10). */
export const REACTIONS = ['👍', '❤️', '😂', '🔥', '👏', '😮'];
const NOT_A_GROUP = { error: 'This is a one-to-one chat.', code: 'NOT_A_GROUP' };

/**
 * B09-F3: the /groups endpoints act on groups only. A DM's creator holds the
 * admin role, so without this they could add a third person to a DM (who then
 * read all of it), rename it, or "leave"/"delete" it and break the pair.
 */
async function notAGroup(chatId: string): Promise<{ status: number; body: object } | null> {
  const { data: chat } = await supabase.from('chats').select('is_group').eq('id', chatId).maybeSingle();
  if (!chat) return { status: 404, body: { error: 'Group not found' } };
  if (!(chat as { is_group?: boolean }).is_group) return { status: 400, body: NOT_A_GROUP };
  return null;
}

/** B09-F5/F6: which of these ids are real, live (not deleted) accounts. */
async function liveUserIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  // Oct 2026: any number of people (no group cap) — read in chunks.
  const data = await selectAllIn<{ id: string }>(ids, (c, from, to) => supabase.from('users').select('id').in('id', c).is('deleted_at', null).order('id').range(from, to));
  return new Set(data.map((u) => u.id));
}

/** B09-F5/F20: a group name is a string with something in it. */
function groupNameError(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return 'Give the group a name.';
  if (name.trim().length > LIMITS.groupNameMax) return `Group name must be ${LIMITS.groupNameMax} characters or fewer`;
  return null;
}

/**
 * B09-F11: what "unread" means, for the chat list's numbers and the Home dot
 * alike — not mine, not deleted, not read by me, not from someone blocked
 * either way. (Deleted senders are dropped by the callers with deletedIdSet.)
 */
function unreadQuery(chatIds: string[], userId: string, blocked: Set<string>, cap: number) {
  let q = supabase
    .from('messages')
    .select('id, chat_id, sender_id')
    .in('chat_id', chatIds)
    .neq('sender_id', userId)
    .eq('is_deleted', false)
    .not('read_by', 'cs', `{${userId}}`)
    .limit(cap);
  q = excludeIds(q, 'sender_id', blocked);
  return q;
}

// ─── SC-241: 1:1 DM block/privacy gate for EXISTING conversations ────────────
// getOrCreateDM enforces block + message_privacy ONLY when a DM is first created.
// Every path that acts on an existing chat (send/read/react/mark-read) must apply
// the same gate, or a block/privacy setting is bypassed for any thread that
// already exists. These helpers isolate the 1:1 case: a GROUP chat (is_group) or
// any chat without EXACTLY one counterpart returns null → the caller skips the
// gate, so group sends are never affected by a block between two members.
async function dmCounterpartId(chatId: string, userId: string): Promise<string | null> {
  const { data: chat } = await supabase
    .from('chats')
    .select('is_group')
    .eq('id', chatId)
    .maybeSingle();
  if (!chat || chat.is_group) return null; // group or missing → not a 1:1 DM
  const { data: parts } = await supabase
    .from('chat_participants')
    .select('user_id')
    .is('left_at', null)
    .eq('chat_id', chatId)
    .neq('user_id', userId);
  const others = (parts ?? []).map((p) => p.user_id as string);
  return others.length === 1 ? others[0] : null;
}

// Block-only gate (read/react/mark-read): true when the caller is blocked
// either-direction with the 1:1 counterpart. Groups → false (never gated).
async function isDmBlocked(chatId: string, userId: string): Promise<boolean> {
  const other = await dmCounterpartId(chatId, userId);
  if (!other) return false;
  return isBlockedBetween(userId, other);
}

// Send gate (sendMessage): block (either direction) AND the recipient's
// message_privacy, mirroring getOrCreateDM so privacy→nobody/followers is
// honoured in an existing thread too. Returns an error {status,error} or null.
async function dmSendGate(
  chatId: string,
  userId: string,
): Promise<{ status: number; error: string } | null> {
  const other = await dmCounterpartId(chatId, userId);
  if (!other) return null; // group / non-1:1 → no DM gate
  if (await isBlockedBetween(userId, other)) {
    return { status: 403, error: 'You can’t message this user.' };
  }
  const { data: target } = await supabase
    .from('users')
    .select('message_privacy')
    .eq('id', other)
    .maybeSingle();
  const privacy = (target?.message_privacy as string) ?? 'everyone';
  if (privacy === 'nobody') {
    return { status: 403, error: 'This user isn’t accepting new messages.' };
  }
  if (privacy === 'followers') {
    const { data: follows } = await supabase
      .from('follow_relationships')
      .select('id')
      .eq('follower_id', userId)
      .eq('following_id', other)
      .limit(1)
      .maybeSingle();
    if (!follows) {
      return { status: 403, error: 'Only people they follow can message this user.' };
    }
  }
  return null;
}

// ─── SC-341: mark DELIVERY ────────────────────────────────────────────────────
// "delivered" = the recipient's app has RECEIVED the message (a chat-list/thread
// poll fetched it) but they may not have opened the thread yet. We stamp it on the
// recipient's poll — NOT on send — so it is distinct from "read" (which only fires
// when they open the thread). Bounded to the undelivered delta (messages this user
// hasn't been added to yet), so steady-state polls do ~zero writes.
async function markDeliveredForUser(chatIds: string[], userId: string): Promise<void> {
  if (chatIds.length === 0) return;
  const pending: Array<{ id: string; delivered_to: unknown }> = [];
  for (const part of chunks(chatIds)) { // BUILD 1.13: never one huge id list
    if (pending.length >= 500) break;
    const { data } = await supabase
      .from('messages')
      .select('id, delivered_to')
      .in('chat_id', part)
      .neq('sender_id', userId)
      .not('delivered_to', 'cs', `{${userId}}`)
      .limit(500 - pending.length);
    pending.push(...((data ?? []) as Array<{ id: string; delivered_to: unknown }>));
  }
  if (pending.length === 0) return;
  for (const m of pending) {
    const delivered = Array.isArray(m.delivered_to) ? m.delivered_to : [];
    await supabase
      .from('messages')
      .update({ delivered_to: [...delivered, userId] })
      .eq('id', m.id);
  }
}

// ─── LIST MY CHATS ──────────────────────────────────────────────────────────
export async function listChats(req: Request, res: Response) {
  const userId = req.userId!;

  // Get chat IDs for this user
  const { data: participations, error: pErr } = await supabase
    .from('chat_participants')
    .select('chat_id')
    .is('left_at', null)
    .eq('user_id', userId);

  if (pErr) return res.status(500).json({ error: sanitizeError(pErr) });

  const chatIds = (participations || []).map((p) => p.chat_id);
  if (chatIds.length === 0) return res.json({ data: [], chats: [] });

  // SC-341: the recipient's list poll is where "delivered" is stamped — their app
  // has now received these messages even though they haven't opened the thread.
  await markDeliveredForUser(chatIds, userId);

  const lcp = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
  let chats: Array<Record<string, any>> | null;
  let liveTotal: number | null;
  if (chatIds.length <= IN_CHUNK) {
    const r = await supabase
      .from('chats')
      // B09-F20: count the chats that are listed — a deleted one made `total` too big.
      .select('*', { count: 'exact' })
      .in('id', chatIds)
      .is('deleted_at', null) // soft-deleted groups (098) are in no list
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(lcp.from, lcp.to);
    if (r.error) return res.status(500).json({ error: sanitizeError(r.error) });
    chats = r.data;
    liveTotal = r.count ?? null;
  } else {
    // BUILD 1.13: too many chats for one id list in the URL (it was a 500).
    // Read each chunk's order key, order them here as the database would
    // (newest message first, never-messaged last), then fetch just the page.
    const heads: Array<{ id: string; last_message_at: string | null }> = [];
    for (const part of chunks(chatIds)) {
      const r = await supabase.from('chats').select('id, last_message_at').in('id', part).is('deleted_at', null);
      if (r.error) return res.status(500).json({ error: sanitizeError(r.error) });
      heads.push(...((r.data ?? []) as Array<{ id: string; last_message_at: string | null }>));
    }
    heads.sort((a, b) => {
      if (a.last_message_at === b.last_message_at) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      if (a.last_message_at == null) return 1;
      if (b.last_message_at == null) return -1;
      return a.last_message_at < b.last_message_at ? 1 : -1;
    });
    const pageIds = heads.slice(lcp.from, lcp.to + 1).map((h) => h.id);
    const r = pageIds.length > 0 ? await supabase.from('chats').select('*').in('id', pageIds) : { data: [], error: null };
    if (r.error) return res.status(500).json({ error: sanitizeError(r.error) });
    const byId = new Map(((r.data ?? []) as Array<Record<string, any>>).map((c) => [c.id as string, c]));
    chats = pageIds.map((id) => byId.get(id)).filter((c): c is Record<string, any> => !!c);
    liveTotal = heads.length;
  }

  const blocked = await blockedUserIds(userId);
  // Enrich with participants and last message
  const withUnread = await Promise.all(
    (chats || []).map(async (chat) => {
      const { data: participants } = await supabase
        .from('chat_participants')
        .select(`
          user_id, role,
          user:users!user_id(id, name, username, profile_picture_url)
        `)
        .is('left_at', null)
        .eq('chat_id', chat.id);

      const { data: lastMsg } = await supabase
        .from('messages')
        .select(`
          id, content, sender_id, created_at, is_system,
          sender:users!sender_id(id, name, username)
        `)
        .eq('chat_id', chat.id)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Unread (B09-F11): the Home dot's predicate, so the two never disagree.
      const { data: unreadRows } = await unreadQuery([chat.id], userId, blocked, UNREAD_SCAN_CAP);

      return {
        chat: {
          ...chat,
          participants: participants || [],
          lastMessage: lastMsg,
        },
        unread: (unreadRows ?? []) as Array<{ sender_id: string }>,
      };
    })
  );
  const dead = await deletedIdSet([...new Set(withUnread.flatMap((c) => c.unread.map((m) => m.sender_id)))]);
  const enriched = withUnread.map(({ chat, unread }) => ({
    ...chat,
    unreadCount: unread.filter((m) => !dead.has(m.sender_id)).length,
  }));

  // SC-299: pagination envelope so the FE knows whether older chats remain. The
  // true total is the number of chats the user participates in (chatIds), not the
  // ranged page — so has_more is accurate regardless of the page window.
  return res.json({ data: enriched, chats: enriched, ...pageMeta(liveTotal ?? chatIds.length, lcp) });
}

// ─── ONE CHAT ────────────────────────────────────────────────────────────────
// B09-F19 · GET /messages/chats/:id — one chat and its members, for Group info.
// It used to scan the newest page of listChats, so a group past your newest 50
// chats read "This group is no longer available".
export async function getChat(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  if (!(await isActiveMember(id, userId))) return res.status(403).json({ error: 'Not a member of this chat' });
  const { data: chat, error } = await supabase.from('chats').select('*').eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) return res.status(500).json({ error: sanitizeError(error) });
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  const { data: participants } = await supabase
    .from('chat_participants')
    .select(`
      user_id, role,
      user:users!user_id(id, name, username, profile_picture_url)
    `)
    .is('left_at', null)
    .eq('chat_id', id);
  const full = { ...chat, participants: participants || [] };
  return res.json({ data: full, chat: full });
}

// ─── UNREAD MESSAGE COUNT (badge) ───────────────────────────────────────────
// SC-349 · GET /messages/unread-count — total unread across ALL of my chats, for
// the Home header 💬 dot (the 🔔 dot has had `unreadCount` from /notifications
// since day one; the chat icon had no source at all).
//
// listChats CANNOT serve this: it is paginated (50/page), so a user whose unread
// thread sits on page 2 would show no dot. This is one flat scan instead.
//
// "Unread" is the same predicate markAsRead clears, plus the exclusions a badge
// needs so it never nags about something the user can't act on:
//   • sender_id != me      — my own sends are never unread to me
//   • is_deleted = false   — a deleted message shows as "message deleted", not new
//   • read_by !cs {me}     — read_by is uuid[] NOT NULL DEFAULT '{}' (mig 013), so
//                            the containment filter is never NULL-swallowed
//   • blocked senders      — bidirectional; a blocked user's message stays in the
//                            thread but must not raise a badge
//   • soft-deleted senders — the message stays (anonymised "Deleted User", per
//                            activeUser.ts) but a dead account can't warrant a ping
const UNREAD_SCAN_CAP = 500; // the badge is a dot; scanning past this buys nothing
export async function getUnreadCount(req: Request, res: Response) {
  const userId = req.userId!;

  // Your chats and your block list are independent — one round, not two.
  const [{ data: participations, error: pErr }, blocked] = await Promise.all([
    // 098: current memberships of chats that still exist.
    supabase.from('chat_participants').select('chat_id, chat:chats!inner(deleted_at)').is('left_at', null)
      .is('chat.deleted_at', null).eq('user_id', userId),
    blockedUserIds(userId),
  ]);
  if (pErr) return res.status(500).json({ error: sanitizeError(pErr) });

  const chatIds = (participations || []).map((p) => p.chat_id);
  if (chatIds.length === 0) return res.json({ unread: 0, chats: 0, capped: false });

  // BUILD 1.13: in chunks — hundreds of chat ids in one URL were refused (500).
  const candidates: Array<{ chat_id: string; sender_id: string }> = [];
  for (const part of chunks(chatIds)) {
    if (candidates.length >= UNREAD_SCAN_CAP) break;
    const { data: rows, error } = await unreadQuery(part, userId, blocked, UNREAD_SCAN_CAP - candidates.length);
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    candidates.push(...((rows || []) as Array<{ chat_id: string; sender_id: string }>));
  }
  // Soft-deleted senders: one small id-set query (deletedIdSet), not a join, so a
  // missing/odd users row can never drop a legitimate unread message.
  const senderIds = [...new Set(candidates.map((m) => m.sender_id as string))];
  const dead = await deletedIdSet(senderIds);
  const live = candidates.filter((m) => !dead.has(m.sender_id as string));

  return res.json({
    unread: live.length,
    chats: new Set(live.map((m) => m.chat_id as string)).size,
    // Honest about the scan cap rather than silently reporting exactly 500.
    capped: candidates.length >= UNREAD_SCAN_CAP,
  });
}

// ─── GET OR CREATE DM CHAT ─────────────────────────────────────────────────
export async function getOrCreateDM(req: Request, res: Response) {
  const userId = req.userId!;
  // Accept either { other_user_id } (legacy) or { user_id } (frontend).
  const other_user_id = req.body?.other_user_id ?? req.body?.user_id;

  if (!other_user_id) return res.status(400).json({ error: 'user_id required' });
  // SC-396: opening a DM with yourself created a real one-participant chat that
  // then appeared in the chat list. Every other social action already refuses
  // self-targeting (follow, invite, gift); this one did not.
  if (other_user_id === userId) {
    return res.status(400).json({ error: 'You can’t start a chat with yourself.', code: 'SELF_DM' });
  }
  if (!isUuid(other_user_id)) {
    return res.status(400).json({ error: 'user_id must be a valid id', code: 'INVALID_ID' });
  }

  // Find existing DM
  const { data: myChats } = await supabase
    .from('chat_participants')
    .select('chat_id')
    .is('left_at', null)
    .eq('user_id', userId);

  const { data: theirChats } = await supabase
    .from('chat_participants')
    .select('chat_id')
    .is('left_at', null)
    .eq('user_id', other_user_id);

  const myIds = new Set((myChats || []).map((c) => c.chat_id));
  const commonIds = (theirChats || []).filter((c) => myIds.has(c.chat_id)).map((c) => c.chat_id);

  if (commonIds.length > 0) {
    // Check if any are non-group
    const { data: existing } = await supabase
      .from('chats')
      .select('*')
      .in('id', commonIds)
      .eq('is_group', false)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    if (existing) return res.json({ data: existing, chat: existing });
  }

  // B09-F5: an unknown or deleted account can't be messaged — this used to make
  // a chat with nobody in it and answer 201.
  if (!(await liveUserIds([other_user_id])).has(other_user_id)) {
    return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
  }

  // Gate NEW DM creation (SC-A1): honour blocks in either direction (a
  // pre-existing hole — blocks weren't enforced on DM creation) and the
  // target's message_privacy. Existing conversations above are unaffected.
  if (other_user_id !== userId) {
    const { data: block } = await supabase
      .from('user_blocks')
      .select('id')
      .or(`and(blocker_id.eq.${userId},blocked_id.eq.${other_user_id}),and(blocker_id.eq.${other_user_id},blocked_id.eq.${userId})`)
      .limit(1)
      .maybeSingle();
    if (block) return res.status(403).json({ error: 'You can’t message this user.' });

    const { data: target } = await supabase
      .from('users')
      .select('message_privacy')
      .eq('id', other_user_id)
      .maybeSingle();
    const privacy = (target?.message_privacy as string) ?? 'everyone';
    if (privacy === 'nobody') {
      return res.status(403).json({ error: 'This user isn’t accepting new messages.' });
    }
    if (privacy === 'followers') {
      const { data: follows } = await supabase
        .from('follow_relationships')
        .select('id')
        .eq('follower_id', userId)
        .eq('following_id', other_user_id)
        .limit(1)
        .maybeSingle();
      if (!follows) {
        return res.status(403).json({ error: 'Only people they follow can message this user.' });
      }
    }
  }

  // SC-62: one DM per pair. dm_key is the sorted user-id pair, backed by a
  // UNIQUE index on chats (migration 042). Racing get-or-create calls that both
  // got past the participant lookup above now collide on the insert: the loser
  // gets 23505 and returns the winner's chat, so exactly one conversation exists.
  const [a, b] = [userId, other_user_id].sort();
  const dmKey = `${a}:${b}`;

  // B09-F3: the pair's DM may already exist but be broken by the old group
  // endpoints — one side "left", or it was "deleted". Mend it rather than hand
  // back a chat the caller can't read, or collide with its dm_key for ever.
  const { data: keyed } = await supabase
    .from('chats').select('*').eq('dm_key', dmKey).eq('is_group', false).maybeSingle();
  if (keyed) {
    const mended = await mendDm(keyed, [userId, other_user_id]);
    return res.json({ data: mended, chat: mended });
  }

  const { data: chat, error } = await supabase
    .from('chats')
    .insert({ is_group: false, created_by: userId, dm_key: dmKey })
    .select()
    .single();

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      const { data: existingChat } = await supabase
        .from('chats')
        .select('*')
        .eq('dm_key', dmKey)
        .eq('is_group', false)
        .maybeSingle();
      if (existingChat) {
        const mended = await mendDm(existingChat, [userId, other_user_id]);
        return res.json({ data: mended, chat: mended });
      }
    }
    return res.status(500).json({ error: sanitizeError(error) });
  }

  const { error: partErr } = await supabase.from('chat_participants').insert([
    { chat_id: chat.id, user_id: userId, role: 'admin' },
    { chat_id: chat.id, user_id: other_user_id, role: 'member' },
  ]);
  if (partErr) {
    // B09-F5: no chat without its two people — take it back out of every list.
    console.error('DM chat_participants insert failed:', partErr.message);
    await softDeleteChat(chat.id);
    return res.status(500).json({ error: 'Could not start the chat. Try again.' });
  }

  return res.status(201).json({ data: chat, chat });
}

/** B09-F3: a DM is always its two people, and never deleted. */
async function mendDm<T extends { id: string; deleted_at?: string | null }>(chat: T, pair: string[]): Promise<T> {
  if (chat.deleted_at) {
    await supabase.from('chats').update({ deleted_at: null }).eq('id', chat.id);
  }
  // joinChat leaves a current member alone and rejoins one who left.
  await joinChat(chat.id, pair.map((user_id) => ({ user_id, role: 'member' as const })));
  return { ...chat, deleted_at: null };
}

// Decision 5 (Dipak, 29 Sep 2026): "Who can message you" also decides who can
// add you to a group — being added used to get round it. Same meaning as
// dmSendGate: nobody → no one; followers → only people who follow them.
// Returns the refusal for the first person the adder may not add, or null.
async function groupAddRefusal(adderId: string, targetIds: string[]): Promise<{ error: string; code: string } | null> {
  if (targetIds.length === 0) return null;
  const [{ data: users }, { data: follows }] = await Promise.all([
    supabase.from('users').select('id, name, message_privacy').in('id', targetIds),
    supabase.from('follow_relationships').select('following_id').eq('follower_id', adderId).in('following_id', targetIds),
  ]);
  const followed = new Set((follows ?? []).map((f: { following_id: string }) => f.following_id));
  for (const u of (users ?? []) as Array<{ id: string; name: string | null; message_privacy: string | null }>) {
    const who = u.name?.trim() || 'This person';
    const privacy = u.message_privacy ?? 'everyone';
    if (privacy === 'nobody') {
      return { error: `${who} isn’t accepting messages, so they can’t be added to a group.`, code: 'MESSAGE_PRIVACY' };
    }
    if (privacy === 'followers' && !followed.has(u.id)) {
      return { error: `${who} only accepts messages from people who follow them, so you can’t add them to a group.`, code: 'MESSAGE_PRIVACY' };
    }
  }
  return null;
}

// ─── CREATE GROUP CHAT ──────────────────────────────────────────────────────
export async function createGroup(req: Request, res: Response) {
  const userId = req.userId!;
  const { name: rawName, icon_url, member_ids: rawMembers } = req.body ?? {};

  // B09-F5: everything checked before anything is written — a bad member list
  // used to leave a group behind with no participants, not even its creator.
  const nameErr = groupNameError(rawName);
  if (nameErr) return res.status(400).json({ error: nameErr });
  const name = (rawName as string).trim();
  if (firstDisallowedImageUrl({ icon_url }, ['icon_url'])) {
    return res.status(400).json({ error: 'icon_url must be an uploaded image URL', code: 'INVALID_IMAGE_URL' });
  }
  if (!Array.isArray(rawMembers) || rawMembers.length === 0) {
    return res.status(400).json({ error: 'At least one member required' });
  }
  if (rawMembers.some((m: unknown) => typeof m !== 'string' || !isUuid(m))) {
    return res.status(400).json({ error: 'member_ids must be user ids', code: 'INVALID_ID' });
  }
  const member_ids = [...new Set(rawMembers as string[])].filter((m) => m !== userId);
  if (member_ids.length === 0) {
    return res.status(400).json({ error: 'At least one member required' });
  }
  // Oct 2026 (Dipak): a group chat has no member cap.
  const live = await liveUserIds(member_ids);
  if (member_ids.some((m) => !live.has(m))) {
    return res.status(404).json({ error: 'Some of these people aren’t on SportClan.', code: 'USER_NOT_FOUND' });
  }
  // addMember's block gate (SC-96), for every pair in the new group.
  const everyone = [userId, ...member_ids];
  const { data: blocks } = await supabase
    .from('user_blocks').select('id').in('blocker_id', everyone).in('blocked_id', everyone).limit(1);
  if ((blocks ?? []).length > 0) {
    return res.status(403).json({ error: 'Can’t create this group — a block exists between some of its members.', code: 'BLOCKED_FROM_GROUP' });
  }
  const privacyRefusal = await groupAddRefusal(userId, member_ids);
  if (privacyRefusal) return res.status(403).json(privacyRefusal);

  const { data: chat, error } = await supabase
    .from('chats')
    .insert({
      is_group: true,
      name,
      icon_url: icon_url || null,
      created_by: userId,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: sanitizeError(error) });

  // Add creator as admin + all members
  const participants = [
    { chat_id: chat.id, user_id: userId, role: 'admin' },
    ...member_ids.map((id: string) => ({
      chat_id: chat.id,
      user_id: id,
      role: 'member',
    })),
  ];

  const { error: partErr } = await supabase.from('chat_participants').insert(participants);
  if (partErr) {
    console.error('Group chat_participants insert failed:', partErr.message);
    await softDeleteChat(chat.id);
    return res.status(500).json({ error: 'Could not create the group. Try again.' });
  }

  // System message
  const { error: sysErr } = await supabase.from('messages').insert({
    chat_id: chat.id,
    sender_id: userId,
    content: `Group "${name}" created`,
    is_system: true,
  });
  if (sysErr) console.error('Group system message insert failed:', sysErr.message);

  return res.status(201).json({ data: chat, chat });
}

// ─── UPDATE GROUP ───────────────────────────────────────────────────────────
export async function updateGroup(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { name, icon_url } = req.body ?? {};

  const notGroup = await notAGroup(id);
  if (notGroup) return res.status(notGroup.status).json(notGroup.body);

  // Check admin
  const { data: participant } = await supabase
    .from('chat_participants')
    .select('role')
    .is('left_at', null)
    .eq('chat_id', id)
    .eq('user_id', userId)
    .single();

  if (!participant || participant.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can update group' });
  }
  // B09-F20: a blank or non-text name is refused, not stored.
  const nameErr = name !== undefined ? groupNameError(name) : null;
  if (nameErr) return res.status(400).json({ error: nameErr });
  if (firstDisallowedImageUrl({ icon_url }, ['icon_url'])) {
    return res.status(400).json({ error: 'icon_url must be an uploaded image URL', code: 'INVALID_IMAGE_URL' });
  }

  const { data, error } = await supabase
    .from('chats')
    .update({
      ...(name !== undefined && { name: (name as string).trim() }),
      ...(icon_url !== undefined && { icon_url }),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: sanitizeError(error) });
  return res.json({ data, chat: data });
}

// ─── ADD MEMBER ─────────────────────────────────────────────────────────────
export async function addMember(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { user_id } = req.body ?? {};

  const notGroup = await notAGroup(id);
  if (notGroup) return res.status(notGroup.status).json(notGroup.body);

  // Check admin
  const { data: participant } = await supabase
    .from('chat_participants')
    .select('role')
    .is('left_at', null)
    .eq('chat_id', id)
    .eq('user_id', userId)
    .single();

  if (!participant || participant.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can add members' });
  }
  // B09-F6: a real, live person — a bogus id answered success and posted
  // "A user was added to the group".
  if (typeof user_id !== 'string' || !isUuid(user_id)) {
    return res.status(400).json({ error: 'user_id must be a valid id', code: 'INVALID_ID' });
  }
  if (!(await liveUserIds([user_id])).has(user_id)) {
    return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
  }

  // Oct 2026 (Dipak): a group chat has no member cap.

  // SC-96: block gate — don't force the new member into a shared group chat with
  // anyone they're blocked-either-direction with (mirrors joinTeamByCode). Covers
  // the adder AND every existing participant.
  const blockedWithNew = await blockedUserIds(user_id);
  if (blockedWithNew.size > 0) {
    const { data: members } = await supabase
      .from('chat_participants')
      .select('user_id')
      .is('left_at', null)
      .eq('chat_id', id);
    if ((members ?? []).some((m) => blockedWithNew.has(m.user_id))) {
      return res.status(403).json({ error: 'Can’t add this user — a block exists with a group member.', code: 'BLOCKED_FROM_GROUP' });
    }
  }

  // 098: a current member is left alone; someone who left is rejoined on the
  // same row (left_at cleared) rather than a second row inserted.
  if (await isActiveMember(id, user_id)) return res.json({ success: true }); // already a member
  const privacyRefusal = await groupAddRefusal(userId, [user_id]);
  if (privacyRefusal) return res.status(403).json(privacyRefusal);
  await joinChat(id, [{ user_id, role: 'member' }]);
  // The system line only for a join that happened.
  if (!(await isActiveMember(id, user_id))) {
    return res.status(500).json({ error: 'Could not add them. Try again.' });
  }

  // System message
  const { data: addedUser } = await supabase
    .from('users')
    .select('name')
    .eq('id', user_id)
    .single();

  const { error: sysErr } = await supabase.from('messages').insert({
    chat_id: id,
    sender_id: userId,
    content: `${addedUser?.name || 'A user'} was added to the group`,
    is_system: true,
  });
  if (sysErr) console.error('Add-member system message failed:', sysErr.message);

  return res.json({ success: true });
}

// ─── REMOVE MEMBER ──────────────────────────────────────────────────────────
export async function removeMember(req: Request, res: Response) {
  const userId = req.userId!;
  const { id, memberId } = req.params;

  const notGroup = await notAGroup(id);
  if (notGroup) return res.status(notGroup.status).json(notGroup.body);

  const { data: participant } = await supabase
    .from('chat_participants')
    .select('role')
    .is('left_at', null)
    .eq('chat_id', id)
    .eq('user_id', userId)
    .single();

  if (!participant || participant.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can remove members' });
  }
  // B09-F6: removing someone who isn't there isn't a success.
  if (!(await isActiveMember(id, memberId))) {
    return res.status(404).json({ error: 'Not a member of this group' });
  }

  // 098: removal is a soft leave — the row stays with left_at set.
  await leaveChat(id, [memberId]);

  return res.json({ success: true });
}

// ─── PROMOTE MEMBER ─────────────────────────────────────────────────────────
export async function promoteMember(req: Request, res: Response) {
  const userId = req.userId!;
  const { id, memberId } = req.params;

  const notGroup = await notAGroup(id);
  if (notGroup) return res.status(notGroup.status).json(notGroup.body);

  const { data: participant } = await supabase
    .from('chat_participants')
    .select('role')
    .is('left_at', null)
    .eq('chat_id', id)
    .eq('user_id', userId)
    .single();

  if (!participant || participant.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can promote members' });
  }

  const { data: promoted, error } = await supabase
    .from('chat_participants')
    .update({ role: 'admin' })
    .eq('chat_id', id)
    .eq('user_id', memberId)
    .is('left_at', null) // can't promote someone who left
    .select('user_id');

  if (error) return res.status(500).json({ error: sanitizeError(error) });
  // B09-F6: nobody promoted → not a member.
  if (!promoted || promoted.length === 0) return res.status(404).json({ error: 'Not a member of this group' });
  return res.json({ success: true });
}

// ─── LEAVE GROUP ────────────────────────────────────────────────────────────
export async function leaveGroup(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  const notGroup = await notAGroup(id);
  if (notGroup) return res.status(notGroup.status).json(notGroup.body);

  // SC-301 (SC-243 sibling): if an ADMIN leaves, hand the group to an heir BEFORE
  // removing them — otherwise the group is left admin-less and becomes a
  // "management zombie" (members can still chat, but nobody can add/remove/
  // promote). Transfer-first-then-remove is the atomicity guarantee: a half-apply
  // leaves a valid admin'd group, never an orphan (SC-243's ordering lesson).
  const { data: me } = await supabase
    .from('chat_participants')
    .select('role')
    .is('left_at', null)
    .eq('chat_id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (me?.role === 'admin') {
    const { data: otherAdmins } = await supabase
      .from('chat_participants')
      .select('user_id')
      .is('left_at', null)
      .eq('chat_id', id)
      .eq('role', 'admin')
      .neq('user_id', userId)
      .limit(1);
    if (!otherAdmins || otherAdmins.length === 0) {
      // Promote the oldest remaining member (by joined_at) — the SC-243 heir rule.
      const { data: heir } = await supabase
        .from('chat_participants')
        .select('user_id')
        .is('left_at', null)
        .eq('chat_id', id)
        .neq('user_id', userId)
        .order('joined_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (heir) {
        await supabase
          .from('chat_participants')
          .update({ role: 'admin' })
          .eq('chat_id', id)
          .eq('user_id', heir.user_id);
      }
    }
  }

  // 098: leaving is a soft leave (left_at), never a delete.
  await leaveChat(id, [userId]);

  // SC-301: if that was the LAST participant, the now-empty group is removed so
  // it can't linger as an undeletable orphan (deleteGroup requires created_by,
  // which a departed creator can no longer satisfy). 098: soft — deleted_at is
  // set; the chat, its participants and messages all stay.
  const { count: remaining } = await supabase
    .from('chat_participants')
    .select('id', { count: 'exact', head: true })
    .is('left_at', null)
    .eq('chat_id', id);
  if ((remaining ?? 0) === 0) {
    await softDeleteChat(id);
  }

  return res.json({ success: true });
}

// ─── DELETE GROUP ───────────────────────────────────────────────────────────
export async function deleteGroup(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  const notGroup = await notAGroup(id);
  if (notGroup) return res.status(notGroup.status).json(notGroup.body);

  const { data: chat } = await supabase
    .from('chats')
    .select('created_by')
    .eq('id', id)
    .single();

  if (!chat || chat.created_by !== userId) {
    return res.status(403).json({ error: 'Only the creator can delete the group' });
  }

  // 098: "Delete group" is a soft delete — the group leaves every list and
  // takes no messages, but nothing is removed.
  const { error: delErr } = await supabase
    .from('chats').update({ deleted_at: new Date().toISOString() }).eq('id', id).is('deleted_at', null);
  if (delErr) return res.status(500).json({ error: 'Failed to delete group' });
  return res.json({ success: true });
}

// ─── GET MESSAGES ───────────────────────────────────────────────────────────
export async function getMessages(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { cursor, limit = '50' } = req.query;
  // B09-F8: bad paging answers 400, not 500.
  const asked = typeof limit === 'string' ? Number(limit) : NaN;
  if (!Number.isInteger(asked) || asked < 1) {
    return res.status(400).json({ error: 'limit must be a whole number from 1', code: 'INVALID_LIMIT' });
  }
  if (cursor !== undefined && (typeof cursor !== 'string' || Number.isNaN(Date.parse(cursor)))) {
    return res.status(400).json({ error: 'cursor must be a date', code: 'INVALID_CURSOR' });
  }
  const pageSize = Math.min(asked, 100);

  // Verify participant
  // 098: a current member of a chat that still exists (not left, not deleted).
  const participant = await isActiveMember(id, userId);

  if (!participant) return res.status(403).json({ error: 'Not a member of this chat' });

  // SC-241: don't serve a 1:1 thread's history to a party blocked either
  // direction (consistent with the sendMessage gate + getOrCreateDM). 403 rather
  // than an empty list so the client shows the same "can't open" state it shows
  // for a blocked profile. Groups → not gated.
  if (await isDmBlocked(id, userId)) {
    return res.status(403).json({ error: 'You can’t view this conversation.' });
  }

  let query = supabase
    .from('messages')
    .select(`
      *,
      sender:users!sender_id(id, name, username, profile_picture_url)
    `)
    .eq('chat_id', id)
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (cursor) query = query.lt('created_at', cursor as string);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: sanitizeError(error) });

  const items = data || [];
  // B09-F9: `reply_to` is the message being replied to, from this chat. The old
  // `messages!reply_to_id` embed ran the other way — it listed the messages
  // replying TO each row, from any chat.
  const parentIds = [...new Set(items.map((m: { reply_to_id?: string | null }) => m.reply_to_id).filter(Boolean))] as string[];
  const parents = new Map<string, unknown>();
  if (parentIds.length > 0) {
    const { data: rows } = await supabase
      .from('messages')
      .select('id, content, sender:users!sender_id(id, name)')
      .in('id', parentIds)
      .eq('chat_id', id);
    for (const r of rows ?? []) parents.set((r as { id: string }).id, r);
  }
  for (const m of items as Array<{ reply_to_id?: string | null; reply_to?: unknown }>) {
    m.reply_to = m.reply_to_id ? parents.get(m.reply_to_id) ?? null : null;
  }
  const reversed = items.reverse();

  // SC-344: real typing — OTHER participants whose typing_until is still in the
  // future (set by their /typing pings). Rides the existing 6s message poll, so no
  // extra request and no websocket. Lapses on its own when they stop / send.
  const nowIso = new Date().toISOString();
  const { data: typingRows } = await supabase
    .from('chat_participants')
    .select('user_id, typing_until, user:users!user_id(id, name)')
    .is('left_at', null)
    .eq('chat_id', id)
    .neq('user_id', userId)
    .gt('typing_until', nowIso);
  const typing = (typingRows ?? [])
    // SC-431: re-checked against THIS process's clock. The .gt() above uses the
    // database's; when the two drift, a lapsed "typing…" would otherwise linger.
    .filter((r: any) => isTypingActive(r.typing_until))
    .map((r: any) => ({
      user_id: r.user_id,
      name: r.user?.name ?? 'Someone',
    }));

  return res.json({
    items: reversed,
    messages: reversed,
    typing,
    nextCursor: items.length === pageSize ? items[0]?.created_at : null,
    hasMore: items.length === pageSize,
  });
}

// PRD Addition #14 — hard cap on chat message length.
const MAX_MESSAGE_LENGTH = 1000;

// ─── SEND MESSAGE ───────────────────────────────────────────────────────────
export async function sendMessage(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  // Frontend may send either { content } (legacy) or { text } (new).
  // Media: image_url + audio_url + audio_duration_ms (polish-pass addition).
  const {
    content,
    text,
    reply_to_id,
    image_url: imageUrl,
    audio_url: audioUrl,
  } = req.body;

  const body = (typeof text === 'string' && text) ? text : content;

  // SC-75: chat is TEXT + LINK only. Reject any media so the scope is ENFORCED
  // server-side, not merely hidden in the UI (the endpoint is reachable via a
  // direct API call). Links need no special handling — they're plain text the
  // client renders. The shared /uploads/profile-photo endpoint is left intact
  // (profile / team logos / post images still use it); only chat message media
  // is refused here, and the chat-only /uploads/audio endpoint is disabled.
  if (imageUrl || audioUrl) {
    return res.status(400).json({ error: 'Chat supports text and links only.', code: 'CHAT_TEXT_ONLY' });
  }
  // B09-F7: a message is text with something in it — spaces, a number or a
  // list were stored as an empty bubble.
  if (typeof body !== 'string' || !body.trim()) {
    return res.status(400).json({ error: 'Type a message first.', code: 'EMPTY_MESSAGE' });
  }
  if (reply_to_id != null && (typeof reply_to_id !== 'string' || !isUuid(reply_to_id))) {
    return res.status(400).json({ error: 'reply_to_id must be a valid id', code: 'INVALID_ID' });
  }
  if (typeof body === 'string' && body.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message exceeds ${MAX_MESSAGE_LENGTH} character limit` });
  }

  // Verify participant
  // 098: a current member of a chat that still exists (not left, not deleted).
  const participant = await isActiveMember(id, userId);

  if (!participant) return res.status(403).json({ error: 'Not a member of this chat' });

  // SC-241: a block/privacy setting must gate an EXISTING 1:1 thread, not only
  // new-DM creation. Groups return null from the gate → unaffected.
  const gate = await dmSendGate(id, userId);
  if (gate) return res.status(gate.status).json({ error: gate.error });

  // B09-F9: a reply points at a message in this chat.
  if (reply_to_id) {
    const { data: parent } = await supabase
      .from('messages').select('id').eq('id', reply_to_id).eq('chat_id', id).maybeSingle();
    if (!parent) return res.status(400).json({ error: 'You can only reply to a message in this chat.', code: 'INVALID_REPLY' });
  }

  // Build insert payload. Some columns may not exist on older schemas;
  // pgrest will surface an error if so, which we propagate.
  // Text + link only (SC-75) — media is rejected above, so nothing to store.
  const insertPayload: Record<string, unknown> = {
    chat_id: id,
    sender_id: userId,
    content: body.trim(),
    reply_to_id: reply_to_id || null,
  };

  const { data, error } = await supabase
    .from('messages')
    .insert(insertPayload)
    .select(`
      *,
      sender:users!sender_id(id, name, username, profile_picture_url)
    `)
    .single();

  if (error) return res.status(500).json({ error: sanitizeError(error) });

  // B13 (D18): a push to the other members — fire-and-forget, throttled.
  void pushChatMessage(id, userId, data?.sender?.name ?? 'Someone', body);

  // Parse @mentions and create notifications (fire-and-forget)
  {
    const mentionMatches = body.match(/@([a-zA-Z0-9_]+)/g);
    if (mentionMatches && mentionMatches.length > 0) {
      const usernames = mentionMatches.map((m) => m.slice(1).toLowerCase());
      const { data: mentioned } = await supabase
        .from('users')
        .select('id, username')
        .in('username', usernames);
      // B15 (V069): only people whose "Who can tag you" allows this author.
      const allowed = new Set(await taggableBy(userId, (mentioned ?? []).map((u) => u.id)));
      for (const u of mentioned ?? []) {
        if (u.id === userId) continue; // don't notify self
        if (!allowed.has(u.id)) continue;
        // Unchanged by B13 (decided 27 Sep 2026): a chat @mention keeps its own
        // path — always delivered, not behind the "Chat messages" switch.
        supabase.from('notifications').insert({
          user_id: u.id,
          type: 'mention_in_chat',
          title: 'You were mentioned',
          body: `${data?.sender?.name ?? 'Someone'} mentioned you in a chat`,
          data: { chatId: id, messageId: data?.id },
        }).then(
          ({ error }) => { if (error) console.warn('[mention-notify] insert failed:', error.message); },
          (e) => console.warn('[mention-notify] threw:', e instanceof Error ? e.message : e),
        ); // SC-112: best-effort, non-blocking — but log a failure instead of dropping it silently
      }
    }
  }

  return res.status(201).json({ data, message: data });
}

// ─── DELETE MESSAGE ─────────────────────────────────────────────────────────
export async function deleteMessage(req: Request, res: Response) {
  const userId = req.userId!;
  const { messageId } = req.params;
  // Decision 3 (Dipak, 29 Sep 2026): a sender can delete their message for
  // everyone at any age — the app asks first ("Delete for everyone?") and the
  // bubble says "This message was deleted". The old 5-minute `for_everyone`
  // window (never sent by the app) is gone; the flag is accepted and ignored.
  const { data: msg } = await supabase
    .from('messages')
    .select('sender_id, created_at')
    .eq('id', messageId)
    .single();

  if (!msg) return res.status(404).json({ error: 'Message not found' });

  // SC-35: a server-side soft-delete blanks the message for EVERYONE, so it
  // must be sender-only regardless of `for_everyone`. Previously the mutation
  // ran scoped only by messageId with no check on the delete-for-me path, so
  // any authenticated user could blank anyone's message by id. A true per-user
  // "delete for me" needs a per-user hide table (not built yet); until then a
  // non-sender cannot delete.
  if (msg.sender_id !== userId) {
    return res.status(403).json({ error: 'Only the sender can delete this message' });
  }

  const { data: updated, error } = await supabase
    .from('messages')
    .update({ is_deleted: true, content: null, image_url: null })
    .eq('id', messageId)
    .eq('sender_id', userId)
    .select('id');

  if (error) return res.status(500).json({ error: sanitizeError(error) });
  if (!updated || updated.length === 0) return res.status(404).json({ error: 'Message not found' });
  return res.json({ success: true });
}

// ─── FORWARD MESSAGE ────────────────────────────────────────────────────────
// SC-94: reuse the same participant check sendMessage/getMessages use.
async function isChatParticipant(chatId: string, userId: string): Promise<boolean> {
  // 098: current member (left_at unset) of a chat that isn't deleted.
  return isActiveMember(chatId, userId);
}


export async function forwardMessage(req: Request, res: Response) {
  const userId = req.userId!;
  const { message_id, chat_ids } = req.body ?? {};

  if (!message_id || !Array.isArray(chat_ids) || chat_ids.length === 0) {
    return res.status(400).json({ error: 'message_id and chat_ids required' });
  }
  // B09-F8: ids are ids.
  if (typeof message_id !== 'string' || !isUuid(message_id) || chat_ids.some((c: unknown) => typeof c !== 'string' || !isUuid(c))) {
    return res.status(400).json({ error: 'message_id and chat_ids must be valid ids', code: 'INVALID_ID' });
  }
  if (tooManyItems(chat_ids, ARRAY_LIMITS.forwardChats)) {
    return res.status(400).json({ error: `Too many chats (max ${ARRAY_LIMITS.forwardChats})` });
  }

  const { data: original } = await supabase
    .from('messages')
    .select('content, image_url, chat_id, is_deleted, is_system')
    .eq('id', message_id)
    .maybeSingle();

  if (!original) return res.status(404).json({ error: 'Original message not found' });
  // B09-F7: a deleted message or a system line forwarded as an empty bubble.
  if (original.is_deleted || original.is_system || !original.content) {
    return res.status(409).json({ error: 'This message can’t be forwarded.', code: 'CANNOT_FORWARD' });
  }

  // SC-94 SOURCE: the caller must belong to the chat the message came from —
  // otherwise they could read (and re-emit) a message from a chat they're not in.
  if (!(await isChatParticipant(original.chat_id, userId))) {
    return res.status(403).json({ error: 'Not a member of the source chat' });
  }

  // SC-94 TARGET: the caller must belong to EVERY target chat — no partial
  // inject. Also respect blocks on a DM target (mirrors getOrCreateDM).
  for (const chatId of chat_ids as string[]) {
    if (!(await isChatParticipant(chatId, userId))) {
      return res.status(403).json({ error: 'Not a member of a target chat' });
    }
    const { data: others } = await supabase
      .from('chat_participants')
      .select('user_id')
      .is('left_at', null)
      .eq('chat_id', chatId)
      .neq('user_id', userId);
    const otherIds = (others ?? []).map((o) => o.user_id as string);
    if (otherIds.length === 1 && (await isBlockedBetween(userId, otherIds[0]))) {
      return res.status(403).json({ error: 'You can’t message this user.' });
    }
  }

  const inserts = (chat_ids as string[]).map((chatId) => ({
    chat_id: chatId,
    sender_id: userId,
    content: original.content,
    image_url: original.image_url,
    forwarded_from: message_id,
  }));

  const { error } = await supabase.from('messages').insert(inserts);
  if (error) return res.status(500).json({ error: sanitizeError(error) });
  return res.json({ success: true, forwarded_to: chat_ids.length });
}

// POST /messages/read  { messageIds: string[] }
// Batch-append the caller's id to each message's read_by array if it isn't
// already present. Idempotent and cheap — PostgREST's array_append via
// rpc isn't available, so we read each row, compute the next array, and
// write it back in a single bulk update.
export async function batchMarkRead(req: Request, res: Response) {
  const userId = req.userId!;
  const { messageIds } = req.body ?? {};
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return res.status(400).json({ error: 'messageIds array is required' });
  }
  if (tooManyItems(messageIds, ARRAY_LIMITS.batchIds)) {
    return res.status(400).json({ error: `Too many messageIds (max ${ARRAY_LIMITS.batchIds})` });
  }
  if (messageIds.some((m: unknown) => typeof m !== 'string' || !isUuid(m))) {
    return res.status(400).json({ error: 'messageIds must be valid ids', code: 'INVALID_ID' }); // B09-F8
  }

  // SC-107 IDOR: only mark messages in chats the caller is a participant of.
  // Fetch the caller's chat ids and constrain the read below to messages in
  // those chats, so a caller can't flip read_by on arbitrary messages by id.
  const { data: myChats } = await supabase
    .from('chat_participants')
    .select('chat_id')
    .is('left_at', null)
    .eq('user_id', userId);
  let callerChatIds = (myChats ?? []).map((c) => c.chat_id);
  if (callerChatIds.length === 0) return res.json({ success: true, updated: 0 });

  // SC-241: drop any 1:1 chat whose counterpart is blocked (either direction) so
  // a blocked party can't emit read-receipts into that thread. This spans many
  // chats, so we filter the chat set rather than 403 the whole batch. Groups are
  // kept (a block between two members doesn't gate the group). One query:
  const blocked = await blockedUserIds(userId);
  if (blocked.size > 0) {
    const parts: Array<{ chat_id: string; user_id: string }> = [];
    for (const part of chunks(callerChatIds)) { // BUILD 1.13
      const { data } = await supabase
        .from('chat_participants')
        .select('chat_id, user_id')
        .is('left_at', null)
        .in('chat_id', part)
        .neq('user_id', userId);
      parts.push(...((data ?? []) as Array<{ chat_id: string; user_id: string }>));
    }
    const counts = new Map<string, number>();
    const blockedDm = new Set<string>();
    for (const p of parts ?? []) {
      counts.set(p.chat_id, (counts.get(p.chat_id) ?? 0) + 1);
    }
    for (const p of parts ?? []) {
      // exactly-one-counterpart (1:1) AND that counterpart is blocked
      if (counts.get(p.chat_id) === 1 && blocked.has(p.user_id as string)) {
        blockedDm.add(p.chat_id as string);
      }
    }
    if (blockedDm.size > 0) callerChatIds = callerChatIds.filter((c) => !blockedDm.has(c));
    if (callerChatIds.length === 0) return res.json({ success: true, updated: 0 });
  }

  // Pull the rows whose read_by doesn't already contain the caller.
  // BUILD 1.13: only the caller's chats, checked here rather than as a huge
  // `.in('chat_id', …)` in the URL (the batch itself is capped).
  const mine = new Set(callerChatIds);
  const { data: found, error } = await supabase
    .from('messages')
    .select('id, read_by, sender_id, chat_id')
    .in('id', messageIds);
  if (error) return res.status(500).json({ error: sanitizeError(error) });
  const rows = (found ?? []).filter((r) => mine.has(r.chat_id as string));

  const updates: Array<{ id: string; read_by: string[] }> = [];
  for (const r of rows ?? []) {
    if (r.sender_id === userId) continue; // never mark own messages
    const existing: string[] = Array.isArray(r.read_by) ? r.read_by : [];
    if (existing.includes(userId)) continue;
    updates.push({ id: r.id, read_by: [...existing, userId] });
  }

  for (const u of updates) {
    await supabase.from('messages').update({ read_by: u.read_by }).eq('id', u.id);
  }

  return res.json({ success: true, updated: updates.length });
}

// ─── MARK AS READ ───────────────────────────────────────────────────────────
export async function markAsRead(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  // Verify participant
  // 098: a current member of a chat that still exists (not left, not deleted).
  const participant = await isActiveMember(id, userId);
  if (!participant) return res.status(403).json({ error: 'Not a member of this chat' });

  // SC-241: a blocked 1:1 party must not emit a read-receipt into the thread.
  if (await isDmBlocked(id, userId)) {
    return res.status(403).json({ error: 'You can’t view this conversation.' });
  }

  // Get unread messages in this chat not sent by me
  const { data: unread } = await supabase
    .from('messages')
    .select('id, read_by, delivered_to')
    .eq('chat_id', id)
    .neq('sender_id', userId)
    .not('read_by', 'cs', `{${userId}}`);

  if (unread && unread.length > 0) {
    for (const msg of unread) {
      const readBy = [...(msg.read_by || []), userId];
      // read_by is written on its own so it can NEVER be coupled to the newer
      // delivered_to column's existence (a missing column must not break reads).
      await supabase.from('messages').update({ read_by: readBy }).eq('id', msg.id);
      // SC-341: reading implies delivered — keep delivered_to monotonic. Best-effort
      // and independent: a pre-migration backend simply skips it.
      const deliveredTo = Array.isArray(msg.delivered_to) ? msg.delivered_to : [];
      if (!deliveredTo.includes(userId)) {
        await supabase.from('messages').update({ delivered_to: [...deliveredTo, userId] }).eq('id', msg.id);
      }
    }
  }

  return res.json({ success: true });
}

// ─── SET TYPING ───────────────────────────────────────────────────────────────
// SC-344 · POST /messages/chats/:id/typing — the caller is actively typing. Set
// their typing_until a few seconds ahead; the FE re-pings (throttled) while typing
// and stops on send/idle, so it lapses on its own. The other party sees it via the
// `typing` field on their next getMessages poll.
export const TYPING_TTL_MS = 8000; // must exceed the FE's ~3s re-ping AND the 6s poll gap

/**
 * SC-431 · is this participant still counted as typing?
 *
 * Extracted because the EXPIRY half of this behaviour used to be verified only by
 * an integration test that slept nine real seconds waiting for a real TTL against
 * a real server — which is inherently timing-sensitive and duly went flaky the
 * moment the suite ran under load. Expiry is a pure comparison; it belongs in a
 * unit test with a clock you control, not in a networked test with a stopwatch.
 *
 * Applied in JS as well as in the query's `.gt()` filter. The database filter is
 * the efficient one; this one is the honest one, because app and database clocks
 * can disagree and a stale "typing…" is exactly the kind of small lie this
 * codebase keeps having to hunt down.
 */
export function isTypingActive(typingUntil: string | null | undefined, now = Date.now()): boolean {
  if (!typingUntil) return false;
  const until = Date.parse(typingUntil);
  return !Number.isNaN(until) && until > now;
}
export async function setTyping(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  // 098: a current member of a chat that still exists (not left, not deleted).
  const participant = await isActiveMember(id, userId);
  if (!participant) return res.status(403).json({ error: 'Not a member of this chat' });
  // Don't leak a typing signal into a blocked 1:1 thread (mirrors markAsRead).
  if (await isDmBlocked(id, userId)) {
    return res.status(403).json({ error: 'You can’t view this conversation.' });
  }
  const until = new Date(Date.now() + TYPING_TTL_MS).toISOString();
  const { error } = await supabase
    .from('chat_participants')
    .update({ typing_until: until })
    .eq('chat_id', id)
    .eq('user_id', userId);
  if (error) return res.status(500).json({ error: sanitizeError(error) });
  return res.json({ ok: true });
}

// ─── GET GROUP MEMBERS ──────────────────────────────────────────────────────
export async function getGroupMembers(req: Request, res: Response) {
  const { id } = req.params;
  // B09-F4: only a member sees who else is in a chat.
  if (!(await isActiveMember(id, req.userId!))) {
    return res.status(403).json({ error: 'Not a member of this chat' });
  }

  const { data, error } = await supabase
    .from('chat_participants')
    .select(`
      user_id, role, joined_at,
      user:users!user_id(id, name, username, profile_picture_url)
    `)
    .is('left_at', null)
    .eq('chat_id', id);

  if (error) return res.status(500).json({ error: sanitizeError(error) });
  return res.json({ data: data || [] });
}

// ─── REACT TO MESSAGE ───────────────────────────────────────────────────────
// PATCH /messages/:messageId/react  { emoji }
// Toggles the current user's reaction: if they already reacted with the
// given emoji it removes theirs, otherwise it adds. Reactions are stored
// in a JSONB column: { "👍": ["user-id-1", "user-id-2"], ... }
export async function reactToMessage(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { messageId } = req.params;
    const { emoji } = req.body || {};
    if (!emoji) return res.status(400).json({ error: 'emoji is required' });
    // B09-F8/F10: one of the app's reactions — junk (and `__proto__`, which read
    // Object.prototype and threw) is refused.
    if (typeof emoji !== 'string' || !REACTIONS.includes(emoji)) {
      return res.status(400).json({ error: 'Pick one of the reactions.', code: 'INVALID_REACTION' });
    }

    const { data: msg, error } = await supabase
      .from('messages')
      .select('id, chat_id, reactions')
      .eq('id', messageId)
      .maybeSingle();
    if (error || !msg) return res.status(404).json({ error: 'Message not found' });

    // SC-242: reactToMessage had NO membership check — any authenticated user
    // could react to any message by id (IDOR, SC-94/SC-107 class). Require the
    // caller to be a participant of the message's chat…
    if (!(await isChatParticipant(msg.chat_id as string, userId))) {
      return res.status(403).json({ error: 'Not a member of this chat' });
    }
    // …and (SC-241) don't let a blocked 1:1 party react into the thread.
    if (await isDmBlocked(msg.chat_id as string, userId)) {
      return res.status(403).json({ error: 'You can’t react in this conversation.' });
    }

    const reactions: Record<string, string[]> = { ...(msg.reactions ?? {}) };
    const current = Object.prototype.hasOwnProperty.call(reactions, emoji) ? reactions[emoji] : [];
    if (current.includes(userId)) {
      reactions[emoji] = current.filter((id: string) => id !== userId);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji] = [...current, userId];
    }

    await supabase
      .from('messages')
      .update({ reactions })
      .eq('id', messageId);

    return res.json({ reactions });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
