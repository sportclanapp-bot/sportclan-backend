import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';

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

  const { data: chats, error } = await supabase
    .from('chats')
    .select('*')
    .in('id', chatIds)
    .order('last_message_at', { ascending: false, nullsFirst: false });

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

  return res.json({ data: enriched, chats: enriched });
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
  const { name, icon_url, member_ids } = req.body;

  if (!name) return res.status(400).json({ error: 'Group name is required' });
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
  const { name, icon_url } = req.body;

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

  await supabase
    .from('chat_participants')
    .delete()
    .eq('chat_id', id)
    .eq('user_id', userId);

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
    audio_duration_ms: audioDurationMs,
  } = req.body;

  const body = (typeof text === 'string' && text) ? text : content;

  // Validation: must have text OR image OR audio
  if (!body && !imageUrl && !audioUrl) {
    return res.status(400).json({ error: 'text, image_url, or audio_url is required' });
  }
  if (body && typeof body === 'string' && body.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message exceeds ${MAX_MESSAGE_LENGTH} character limit` });
  }
  if (audioUrl && typeof audioUrl !== 'string') {
    return res.status(400).json({ error: 'audio_url must be a string' });
  }
  if (imageUrl && typeof imageUrl !== 'string') {
    return res.status(400).json({ error: 'image_url must be a string' });
  }

  // Verify participant
  const { data: participant } = await supabase
    .from('chat_participants')
    .select('id')
    .eq('chat_id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (!participant) return res.status(403).json({ error: 'Not a member of this chat' });

  // Build insert payload. Some columns may not exist on older schemas;
  // pgrest will surface an error if so, which we propagate.
  const insertPayload: Record<string, unknown> = {
    chat_id: id,
    sender_id: userId,
    content: (typeof body === 'string' ? body.trim() : null) || null,
    image_url: imageUrl ?? null,
    reply_to_id: reply_to_id || null,
  };
  if (audioUrl) {
    insertPayload.audio_url = audioUrl;
    if (typeof audioDurationMs === 'number') {
      insertPayload.audio_duration_ms = audioDurationMs;
    }
  }

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
        }).then(() => {});
      }
    }
  }

  return res.status(201).json({ data, message: data });
}

// ─── DELETE MESSAGE ─────────────────────────────────────────────────────────
export async function deleteMessage(req: Request, res: Response) {
  const userId = req.userId!;
  const { messageId } = req.params;
  const { for_everyone } = req.body;

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
export async function forwardMessage(req: Request, res: Response) {
  const userId = req.userId!;
  const { message_id, chat_ids } = req.body;

  if (!message_id || !chat_ids?.length) {
    return res.status(400).json({ error: 'message_id and chat_ids required' });
  }

  const { data: original } = await supabase
    .from('messages')
    .select('content, image_url')
    .eq('id', message_id)
    .single();

  if (!original) return res.status(404).json({ error: 'Original message not found' });

  const inserts = chat_ids.map((chatId: string) => ({
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

  // Pull the rows whose read_by doesn't already contain the caller.
  const { data: rows, error } = await supabase
    .from('messages')
    .select('id, read_by, sender_id')
    .in('id', messageIds);
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
      .select('id, reactions')
      .eq('id', messageId)
      .maybeSingle();
    if (error || !msg) return res.status(404).json({ error: 'Message not found' });

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
