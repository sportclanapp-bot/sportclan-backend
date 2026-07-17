import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { isBlockedBetween, blockedUserIds } from '../utils/blocks';
import { LIMITS, firstInvalidUrl, ARRAY_LIMITS, tooManyItems, firstDisallowedImageUrl } from '../utils/validation';
import { parsePagination, pageMeta } from '../utils/pagination';

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

// ─── LIST MY CHATS ──────────────────────────────────────────────────────────
export async function listChats(req: Request, res: Response) {
  const userId = req.userId!;

  // Get chat IDs for this user
  const { data: participations, error: pErr } = await supabase
    .from('chat_participants')
    .select('chat_id')
    .eq('user_id', userId);

  if (pErr) return res.status(500).json({ error: sanitizeError(pErr) });

  const chatIds = (participations || []).map((p) => p.chat_id);
  if (chatIds.length === 0) return res.json({ data: [], chats: [] });

  const lcp = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
  const { data: chats, error } = await supabase
    .from('chats')
    .select('*')
    .in('id', chatIds)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .range(lcp.from, lcp.to);

  if (error) return res.status(500).json({ error: sanitizeError(error) });

  // Enrich with participants and last message
  const enriched = await Promise.all(
    (chats || []).map(async (chat) => {
      const { data: participants } = await supabase
        .from('chat_participants')
        .select(`
          user_id, role,
          user:users!user_id(id, name, username, profile_picture_url, is_premium)
        `)
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

      // Unread count
      const { count: unreadCount } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('chat_id', chat.id)
        .neq('sender_id', userId)
        .not('read_by', 'cs', `{${userId}}`);

      return {
        ...chat,
        participants: participants || [],
        lastMessage: lastMsg,
        unreadCount: unreadCount ?? 0,
      };
    })
  );

  // SC-299: pagination envelope so the FE knows whether older chats remain. The
  // true total is the number of chats the user participates in (chatIds), not the
  // ranged page — so has_more is accurate regardless of the page window.
  return res.json({ data: enriched, chats: enriched, ...pageMeta(chatIds.length, lcp) });
}

// ─── GET OR CREATE DM CHAT ─────────────────────────────────────────────────
export async function getOrCreateDM(req: Request, res: Response) {
  const userId = req.userId!;
  // Accept either { other_user_id } (legacy) or { user_id } (frontend).
  const other_user_id = req.body?.other_user_id ?? req.body?.user_id;

  if (!other_user_id) return res.status(400).json({ error: 'user_id required' });

  // Find existing DM
  const { data: myChats } = await supabase
    .from('chat_participants')
    .select('chat_id')
    .eq('user_id', userId);

  const { data: theirChats } = await supabase
    .from('chat_participants')
    .select('chat_id')
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
      .limit(1)
      .maybeSingle();

    if (existing) return res.json({ data: existing, chat: existing });
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
      if (existingChat) return res.json({ data: existingChat, chat: existingChat });
    }
    return res.status(500).json({ error: sanitizeError(error) });
  }

  const { error: partErr } = await supabase.from('chat_participants').insert([
    { chat_id: chat.id, user_id: userId, role: 'admin' },
    { chat_id: chat.id, user_id: other_user_id, role: 'member' },
  ]);
  if (partErr) console.error('DM chat_participants insert failed:', partErr.message);

  return res.status(201).json({ data: chat, chat });
}

// ─── CREATE GROUP CHAT ──────────────────────────────────────────────────────
export async function createGroup(req: Request, res: Response) {
  const userId = req.userId!;
  const { name, icon_url, member_ids } = req.body ?? {};

  if (!name) return res.status(400).json({ error: 'Group name is required' });
  if (typeof name === 'string' && name.length > LIMITS.groupNameMax) {
    return res.status(400).json({ error: `Group name must be ${LIMITS.groupNameMax} characters or fewer` });
  }
  if (firstDisallowedImageUrl({ icon_url }, ['icon_url'])) {
    return res.status(400).json({ error: 'icon_url must be an uploaded image URL', code: 'INVALID_IMAGE_URL' });
  }
  if (!member_ids || member_ids.length === 0) {
    return res.status(400).json({ error: 'At least one member required' });
  }
  if (member_ids.length > 49) {
    return res.status(400).json({ error: 'Max 50 members per group' });
  }

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
  if (partErr) console.error('Group chat_participants insert failed:', partErr.message);

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

  // Check admin
  const { data: participant } = await supabase
    .from('chat_participants')
    .select('role')
    .eq('chat_id', id)
    .eq('user_id', userId)
    .single();

  if (!participant || participant.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can update group' });
  }
  if (typeof name === 'string' && name.length > LIMITS.groupNameMax) {
    return res.status(400).json({ error: `Group name must be ${LIMITS.groupNameMax} characters or fewer` });
  }
  if (firstDisallowedImageUrl({ icon_url }, ['icon_url'])) {
    return res.status(400).json({ error: 'icon_url must be an uploaded image URL', code: 'INVALID_IMAGE_URL' });
  }

  const { data, error } = await supabase
    .from('chats')
    .update({
      ...(name !== undefined && { name }),
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
  const { user_id } = req.body;

  // Check admin
  const { data: participant } = await supabase
    .from('chat_participants')
    .select('role')
    .eq('chat_id', id)
    .eq('user_id', userId)
    .single();

  if (!participant || participant.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can add members' });
  }

  // Check group size
  const { count } = await supabase
    .from('chat_participants')
    .select('id', { count: 'exact', head: true })
    .eq('chat_id', id);

  if ((count ?? 0) >= 50) {
    return res.status(400).json({ error: 'Max 50 members per group' });
  }

  // SC-96: block gate — don't force the new member into a shared group chat with
  // anyone they're blocked-either-direction with (mirrors joinTeamByCode). Covers
  // the adder AND every existing participant.
  const blockedWithNew = await blockedUserIds(user_id);
  if (blockedWithNew.size > 0) {
    const { data: members } = await supabase
      .from('chat_participants')
      .select('user_id')
      .eq('chat_id', id);
    if ((members ?? []).some((m) => blockedWithNew.has(m.user_id))) {
      return res.status(403).json({ error: 'Can’t add this user — a block exists with a group member.', code: 'BLOCKED_FROM_GROUP' });
    }
  }

  const { error } = await supabase
    .from('chat_participants')
    .insert({ chat_id: id, user_id, role: 'member' });

  if (error?.code === '23505') return res.json({ success: true }); // already a member
  if (error) return res.status(500).json({ error: sanitizeError(error) });

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

  const { data: participant } = await supabase
    .from('chat_participants')
    .select('role')
    .eq('chat_id', id)
    .eq('user_id', userId)
    .single();

  if (!participant || participant.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can remove members' });
  }

  await supabase
    .from('chat_participants')
    .delete()
    .eq('chat_id', id)
    .eq('user_id', memberId);

  return res.json({ success: true });
}

// ─── PROMOTE MEMBER ─────────────────────────────────────────────────────────
export async function promoteMember(req: Request, res: Response) {
  const userId = req.userId!;
  const { id, memberId } = req.params;

  const { data: participant } = await supabase
    .from('chat_participants')
    .select('role')
    .eq('chat_id', id)
    .eq('user_id', userId)
    .single();

  if (!participant || participant.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can promote members' });
  }

  const { error } = await supabase
    .from('chat_participants')
    .update({ role: 'admin' })
    .eq('chat_id', id)
    .eq('user_id', memberId);

  if (error) return res.status(500).json({ error: sanitizeError(error) });
  return res.json({ success: true });
}

// ─── LEAVE GROUP ────────────────────────────────────────────────────────────
export async function leaveGroup(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  // SC-301 (SC-243 sibling): if an ADMIN leaves, hand the group to an heir BEFORE
  // removing them — otherwise the group is left admin-less and becomes a
  // "management zombie" (members can still chat, but nobody can add/remove/
  // promote). Transfer-first-then-remove is the atomicity guarantee: a half-apply
  // leaves a valid admin'd group, never an orphan (SC-243's ordering lesson).
  const { data: me } = await supabase
    .from('chat_participants')
    .select('role')
    .eq('chat_id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (me?.role === 'admin') {
    const { data: otherAdmins } = await supabase
      .from('chat_participants')
      .select('user_id')
      .eq('chat_id', id)
      .eq('role', 'admin')
      .neq('user_id', userId)
      .limit(1);
    if (!otherAdmins || otherAdmins.length === 0) {
      // Promote the oldest remaining member (by joined_at) — the SC-243 heir rule.
      const { data: heir } = await supabase
        .from('chat_participants')
        .select('user_id')
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

  await supabase
    .from('chat_participants')
    .delete()
    .eq('chat_id', id)
    .eq('user_id', userId);

  // SC-301: if that was the LAST participant, delete the now-empty group so it
  // can't linger as an undeletable orphan (deleteGroup requires created_by, which
  // a departed creator can no longer satisfy). CASCADE clears participants+messages.
  const { count: remaining } = await supabase
    .from('chat_participants')
    .select('id', { count: 'exact', head: true })
    .eq('chat_id', id);
  if ((remaining ?? 0) === 0) {
    await supabase.from('chats').delete().eq('id', id);
  }

  return res.json({ success: true });
}

// ─── DELETE GROUP ───────────────────────────────────────────────────────────
export async function deleteGroup(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  const { data: chat } = await supabase
    .from('chats')
    .select('created_by')
    .eq('id', id)
    .single();

  if (!chat || chat.created_by !== userId) {
    return res.status(403).json({ error: 'Only the creator can delete the group' });
  }

  const { error: delErr } = await supabase.from('chats').delete().eq('id', id);
  if (delErr) return res.status(500).json({ error: 'Failed to delete group' });
  return res.json({ success: true });
}

// ─── GET MESSAGES ───────────────────────────────────────────────────────────
export async function getMessages(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { cursor, limit = '50' } = req.query;
  const pageSize = Math.min(parseInt(limit as string, 10) || 50, 100);

  // Verify participant
  const { data: participant } = await supabase
    .from('chat_participants')
    .select('id')
    .eq('chat_id', id)
    .eq('user_id', userId)
    .maybeSingle();

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
      sender:users!sender_id(id, name, username, profile_picture_url),
      reply_to:messages!reply_to_id(id, content, sender:users!sender_id(id, name))
    `)
    .eq('chat_id', id)
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (cursor) query = query.lt('created_at', cursor as string);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: sanitizeError(error) });

  const items = data || [];
  const reversed = items.reverse();
  return res.json({
    items: reversed,
    messages: reversed,
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
  if (!body) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (typeof body === 'string' && body.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message exceeds ${MAX_MESSAGE_LENGTH} character limit` });
  }

  // Verify participant
  const { data: participant } = await supabase
    .from('chat_participants')
    .select('id')
    .eq('chat_id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (!participant) return res.status(403).json({ error: 'Not a member of this chat' });

  // SC-241: a block/privacy setting must gate an EXISTING 1:1 thread, not only
  // new-DM creation. Groups return null from the gate → unaffected.
  const gate = await dmSendGate(id, userId);
  if (gate) return res.status(gate.status).json({ error: gate.error });

  // Build insert payload. Some columns may not exist on older schemas;
  // pgrest will surface an error if so, which we propagate.
  // Text + link only (SC-75) — media is rejected above, so nothing to store.
  const insertPayload: Record<string, unknown> = {
    chat_id: id,
    sender_id: userId,
    content: (typeof body === 'string' ? body.trim() : null) || null,
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

  // Parse @mentions and create notifications (fire-and-forget)
  if (body && typeof body === 'string') {
    const mentionMatches = body.match(/@([a-zA-Z0-9_]+)/g);
    if (mentionMatches && mentionMatches.length > 0) {
      const usernames = mentionMatches.map((m) => m.slice(1).toLowerCase());
      const { data: mentioned } = await supabase
        .from('users')
        .select('id, username')
        .in('username', usernames);
      for (const u of mentioned ?? []) {
        if (u.id === userId) continue; // don't notify self
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
  // SC-71: a bodyless DELETE leaves req.body undefined; guard the destructure so
  // it defaults to a plain "delete this message" (for_everyone falsy) instead of
  // throwing → 500. Auth behaviour is unchanged (non-sender still 403).
  const { for_everyone } = req.body ?? {};

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
  if (for_everyone) {
    const elapsed = Date.now() - new Date(msg.created_at).getTime();
    if (elapsed > 5 * 60 * 1000) {
      return res.status(403).json({ error: '5-minute window has passed' });
    }
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
  const { data } = await supabase
    .from('chat_participants')
    .select('chat_id')
    .eq('chat_id', chatId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

export async function forwardMessage(req: Request, res: Response) {
  const userId = req.userId!;
  const { message_id, chat_ids } = req.body ?? {};

  if (!message_id || !chat_ids?.length) {
    return res.status(400).json({ error: 'message_id and chat_ids required' });
  }
  if (tooManyItems(chat_ids, ARRAY_LIMITS.forwardChats)) {
    return res.status(400).json({ error: `Too many chats (max ${ARRAY_LIMITS.forwardChats})` });
  }

  const { data: original } = await supabase
    .from('messages')
    .select('content, image_url, chat_id')
    .eq('id', message_id)
    .single();

  if (!original) return res.status(404).json({ error: 'Original message not found' });

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

  // SC-107 IDOR: only mark messages in chats the caller is a participant of.
  // Fetch the caller's chat ids and constrain the read below to messages in
  // those chats, so a caller can't flip read_by on arbitrary messages by id.
  const { data: myChats } = await supabase
    .from('chat_participants')
    .select('chat_id')
    .eq('user_id', userId);
  let callerChatIds = (myChats ?? []).map((c) => c.chat_id);
  if (callerChatIds.length === 0) return res.json({ success: true, updated: 0 });

  // SC-241: drop any 1:1 chat whose counterpart is blocked (either direction) so
  // a blocked party can't emit read-receipts into that thread. This spans many
  // chats, so we filter the chat set rather than 403 the whole batch. Groups are
  // kept (a block between two members doesn't gate the group). One query:
  const blocked = await blockedUserIds(userId);
  if (blocked.size > 0) {
    const { data: parts } = await supabase
      .from('chat_participants')
      .select('chat_id, user_id')
      .in('chat_id', callerChatIds)
      .neq('user_id', userId);
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
  const { data: rows, error } = await supabase
    .from('messages')
    .select('id, read_by, sender_id')
    .in('id', messageIds)
    .in('chat_id', callerChatIds);
  if (error) return res.status(500).json({ error: sanitizeError(error) });

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
  const { data: participant } = await supabase
    .from('chat_participants')
    .select('id')
    .eq('chat_id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!participant) return res.status(403).json({ error: 'Not a member of this chat' });

  // SC-241: a blocked 1:1 party must not emit a read-receipt into the thread.
  if (await isDmBlocked(id, userId)) {
    return res.status(403).json({ error: 'You can’t view this conversation.' });
  }

  // Get unread messages in this chat not sent by me
  const { data: unread } = await supabase
    .from('messages')
    .select('id, read_by')
    .eq('chat_id', id)
    .neq('sender_id', userId)
    .not('read_by', 'cs', `{${userId}}`);

  if (unread && unread.length > 0) {
    for (const msg of unread) {
      const readBy = [...(msg.read_by || []), userId];
      await supabase
        .from('messages')
        .update({ read_by: readBy })
        .eq('id', msg.id);
    }
  }

  return res.json({ success: true });
}

// ─── GET GROUP MEMBERS ──────────────────────────────────────────────────────
export async function getGroupMembers(req: Request, res: Response) {
  const { id } = req.params;

  const { data, error } = await supabase
    .from('chat_participants')
    .select(`
      user_id, role, joined_at,
      user:users!user_id(id, name, username, profile_picture_url, is_premium)
    `)
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

    const reactions: Record<string, string[]> = msg.reactions ?? {};
    const current = reactions[emoji] ?? [];
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
