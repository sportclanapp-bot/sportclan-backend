"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reactToMessage = exports.getGroupMembers = exports.markAsRead = exports.batchMarkRead = exports.forwardMessage = exports.deleteMessage = exports.sendMessage = exports.getMessages = exports.deleteGroup = exports.leaveGroup = exports.promoteMember = exports.removeMember = exports.addMember = exports.updateGroup = exports.createGroup = exports.getOrCreateDM = exports.listChats = void 0;
const supabase_1 = require("../utils/supabase");
const response_1 = require("../utils/response");
// ─── LIST MY CHATS ──────────────────────────────────────────────────────────
async function listChats(req, res) {
    const userId = req.userId;
    // Get chat IDs for this user
    const { data: participations, error: pErr } = await supabase_1.supabase
        .from('chat_participants')
        .select('chat_id')
        .eq('user_id', userId);
    if (pErr)
        return res.status(500).json({ error: (0, response_1.sanitizeError)(pErr) });
    const chatIds = (participations || []).map((p) => p.chat_id);
    if (chatIds.length === 0)
        return res.json({ data: [] });
    const { data: chats, error } = await supabase_1.supabase
        .from('chats')
        .select('*')
        .in('id', chatIds)
        .order('last_message_at', { ascending: false, nullsFirst: false });
    if (error)
        return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
    // Enrich with participants and last message
    const enriched = await Promise.all((chats || []).map(async (chat) => {
        const { data: participants } = await supabase_1.supabase
            .from('chat_participants')
            .select(`
          user_id, role,
          user:users!user_id(id, full_name, username, profile_picture_url, is_premium)
        `)
            .eq('chat_id', chat.id);
        const { data: lastMsg } = await supabase_1.supabase
            .from('messages')
            .select(`
          id, content, sender_id, created_at, is_system,
          sender:users!sender_id(id, full_name, username)
        `)
            .eq('chat_id', chat.id)
            .eq('is_deleted', false)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        // Unread count
        const { count: unreadCount } = await supabase_1.supabase
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
    }));
    return res.json({ data: enriched });
}
exports.listChats = listChats;
// ─── GET OR CREATE DM CHAT ─────────────────────────────────────────────────
async function getOrCreateDM(req, res) {
    const userId = req.userId;
    const { other_user_id } = req.body;
    if (!other_user_id)
        return res.status(400).json({ error: 'other_user_id required' });
    // Find existing DM
    const { data: myChats } = await supabase_1.supabase
        .from('chat_participants')
        .select('chat_id')
        .eq('user_id', userId);
    const { data: theirChats } = await supabase_1.supabase
        .from('chat_participants')
        .select('chat_id')
        .eq('user_id', other_user_id);
    const myIds = new Set((myChats || []).map((c) => c.chat_id));
    const commonIds = (theirChats || []).filter((c) => myIds.has(c.chat_id)).map((c) => c.chat_id);
    if (commonIds.length > 0) {
        // Check if any are non-group
        const { data: existing } = await supabase_1.supabase
            .from('chats')
            .select('*')
            .in('id', commonIds)
            .eq('is_group', false)
            .limit(1)
            .maybeSingle();
        if (existing)
            return res.json({ data: existing });
    }
    // Create new DM
    const { data: chat, error } = await supabase_1.supabase
        .from('chats')
        .insert({ is_group: false, created_by: userId })
        .select()
        .single();
    if (error)
        return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
    await supabase_1.supabase.from('chat_participants').insert([
        { chat_id: chat.id, user_id: userId, role: 'admin' },
        { chat_id: chat.id, user_id: other_user_id, role: 'member' },
    ]);
    return res.status(201).json({ data: chat });
}
exports.getOrCreateDM = getOrCreateDM;
// ─── CREATE GROUP CHAT ──────────────────────────────────────────────────────
async function createGroup(req, res) {
    const userId = req.userId;
    const { name, icon_url, member_ids } = req.body;
    if (!name)
        return res.status(400).json({ error: 'Group name is required' });
    if (!member_ids || member_ids.length === 0) {
        return res.status(400).json({ error: 'At least one member required' });
    }
    if (member_ids.length > 49) {
        return res.status(400).json({ error: 'Max 50 members per group' });
    }
    const { data: chat, error } = await supabase_1.supabase
        .from('chats')
        .insert({
        is_group: true,
        name,
        icon_url: icon_url || null,
        created_by: userId,
    })
        .select()
        .single();
    if (error)
        return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
    // Add creator as admin + all members
    const participants = [
        { chat_id: chat.id, user_id: userId, role: 'admin' },
        ...member_ids.map((id) => ({
            chat_id: chat.id,
            user_id: id,
            role: 'member',
        })),
    ];
    await supabase_1.supabase.from('chat_participants').insert(participants);
    // System message
    await supabase_1.supabase.from('messages').insert({
        chat_id: chat.id,
        sender_id: userId,
        content: `Group "${name}" created`,
        is_system: true,
    });
    return res.status(201).json({ data: chat });
}
exports.createGroup = createGroup;
// ─── UPDATE GROUP ───────────────────────────────────────────────────────────
async function updateGroup(req, res) {
    const userId = req.userId;
    const { id } = req.params;
    const { name, icon_url } = req.body;
    // Check admin
    const { data: participant } = await supabase_1.supabase
        .from('chat_participants')
        .select('role')
        .eq('chat_id', id)
        .eq('user_id', userId)
        .single();
    if (!participant || participant.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can update group' });
    }
    const { data, error } = await supabase_1.supabase
        .from('chats')
        .update({
        ...(name !== undefined && { name }),
        ...(icon_url !== undefined && { icon_url }),
    })
        .eq('id', id)
        .select()
        .single();
    if (error)
        return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
    return res.json({ data });
}
exports.updateGroup = updateGroup;
// ─── ADD MEMBER ─────────────────────────────────────────────────────────────
async function addMember(req, res) {
    const userId = req.userId;
    const { id } = req.params;
    const { user_id } = req.body;
    // Check admin
    const { data: participant } = await supabase_1.supabase
        .from('chat_participants')
        .select('role')
        .eq('chat_id', id)
        .eq('user_id', userId)
        .single();
    if (!participant || participant.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can add members' });
    }
    // Check group size
    const { count } = await supabase_1.supabase
        .from('chat_participants')
        .select('id', { count: 'exact', head: true })
        .eq('chat_id', id);
    if ((count ?? 0) >= 50) {
        return res.status(400).json({ error: 'Max 50 members per group' });
    }
    const { error } = await supabase_1.supabase
        .from('chat_participants')
        .insert({ chat_id: id, user_id, role: 'member' });
    if (error?.code === '23505')
        return res.json({ success: true }); // already a member
    if (error)
        return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
    // System message
    const { data: addedUser } = await supabase_1.supabase
        .from('users')
        .select('full_name')
        .eq('id', user_id)
        .single();
    await supabase_1.supabase.from('messages').insert({
        chat_id: id,
        sender_id: userId,
        content: `${addedUser?.full_name || 'A user'} was added to the group`,
        is_system: true,
    });
    return res.json({ success: true });
}
exports.addMember = addMember;
// ─── REMOVE MEMBER ──────────────────────────────────────────────────────────
async function removeMember(req, res) {
    const userId = req.userId;
    const { id, memberId } = req.params;
    const { data: participant } = await supabase_1.supabase
        .from('chat_participants')
        .select('role')
        .eq('chat_id', id)
        .eq('user_id', userId)
        .single();
    if (!participant || participant.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can remove members' });
    }
    await supabase_1.supabase
        .from('chat_participants')
        .delete()
        .eq('chat_id', id)
        .eq('user_id', memberId);
    return res.json({ success: true });
}
exports.removeMember = removeMember;
// ─── PROMOTE MEMBER ─────────────────────────────────────────────────────────
async function promoteMember(req, res) {
    const userId = req.userId;
    const { id, memberId } = req.params;
    const { data: participant } = await supabase_1.supabase
        .from('chat_participants')
        .select('role')
        .eq('chat_id', id)
        .eq('user_id', userId)
        .single();
    if (!participant || participant.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can promote members' });
    }
    const { error } = await supabase_1.supabase
        .from('chat_participants')
        .update({ role: 'admin' })
        .eq('chat_id', id)
        .eq('user_id', memberId);
    if (error)
        return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
    return res.json({ success: true });
}
exports.promoteMember = promoteMember;
// ─── LEAVE GROUP ────────────────────────────────────────────────────────────
async function leaveGroup(req, res) {
    const userId = req.userId;
    const { id } = req.params;
    await supabase_1.supabase
        .from('chat_participants')
        .delete()
        .eq('chat_id', id)
        .eq('user_id', userId);
    return res.json({ success: true });
}
exports.leaveGroup = leaveGroup;
// ─── DELETE GROUP ───────────────────────────────────────────────────────────
async function deleteGroup(req, res) {
    const userId = req.userId;
    const { id } = req.params;
    const { data: chat } = await supabase_1.supabase
        .from('chats')
        .select('created_by')
        .eq('id', id)
        .single();
    if (!chat || chat.created_by !== userId) {
        return res.status(403).json({ error: 'Only the creator can delete the group' });
    }
    await supabase_1.supabase.from('chats').delete().eq('id', id);
    return res.json({ success: true });
}
exports.deleteGroup = deleteGroup;
// ─── GET MESSAGES ───────────────────────────────────────────────────────────
async function getMessages(req, res) {
    const userId = req.userId;
    const { id } = req.params;
    const { cursor, limit = '50' } = req.query;
    const pageSize = Math.min(parseInt(limit, 10) || 50, 100);
    // Verify participant
    const { data: participant } = await supabase_1.supabase
        .from('chat_participants')
        .select('id')
        .eq('chat_id', id)
        .eq('user_id', userId)
        .maybeSingle();
    if (!participant)
        return res.status(403).json({ error: 'Not a member of this chat' });
    let query = supabase_1.supabase
        .from('messages')
        .select(`
      *,
      sender:users!sender_id(id, full_name, username, profile_picture_url),
      reply_to:messages!reply_to_id(id, content, sender:users!sender_id(id, full_name))
    `)
        .eq('chat_id', id)
        .order('created_at', { ascending: false })
        .limit(pageSize);
    if (cursor)
        query = query.lt('created_at', cursor);
    const { data, error } = await query;
    if (error)
        return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
    const items = data || [];
    return res.json({
        items: items.reverse(),
        nextCursor: items.length === pageSize ? items[0]?.created_at : null,
        hasMore: items.length === pageSize,
    });
}
exports.getMessages = getMessages;
// PRD Addition #14 — hard cap on chat message length.
const MAX_MESSAGE_LENGTH = 1000;
// ─── SEND MESSAGE ───────────────────────────────────────────────────────────
async function sendMessage(req, res) {
    const userId = req.userId;
    const { id } = req.params;
    const { content, image_url, reply_to_id } = req.body;
    if (!content && !image_url) {
        return res.status(400).json({ error: 'Content or image required' });
    }
    if (typeof content === 'string' && content.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ error: `Message exceeds ${MAX_MESSAGE_LENGTH} character limit` });
    }
    // Verify participant
    const { data: participant } = await supabase_1.supabase
        .from('chat_participants')
        .select('id')
        .eq('chat_id', id)
        .eq('user_id', userId)
        .maybeSingle();
    if (!participant)
        return res.status(403).json({ error: 'Not a member of this chat' });
    const { data, error } = await supabase_1.supabase
        .from('messages')
        .insert({
        chat_id: id,
        sender_id: userId,
        content: content?.trim() || null,
        image_url: image_url || null,
        reply_to_id: reply_to_id || null,
    })
        .select(`
      *,
      sender:users!sender_id(id, full_name, username, profile_picture_url)
    `)
        .single();
    if (error)
        return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
    // Parse @mentions and create notifications (fire-and-forget)
    if (content && typeof content === 'string') {
        const mentionMatches = content.match(/@([a-zA-Z0-9_]+)/g);
        if (mentionMatches && mentionMatches.length > 0) {
            const usernames = mentionMatches.map((m) => m.slice(1).toLowerCase());
            const { data: mentioned } = await supabase_1.supabase
                .from('users')
                .select('id, username')
                .in('username', usernames);
            for (const u of mentioned ?? []) {
                if (u.id === userId)
                    continue; // don't notify self
                supabase_1.supabase.from('notifications').insert({
                    user_id: u.id,
                    type: 'mention_in_chat',
                    title: 'You were mentioned',
                    body: `${data?.sender?.full_name ?? 'Someone'} mentioned you in a chat`,
                    data: { chatId: id, messageId: data?.id },
                }).then(() => { });
            }
        }
    }
    return res.status(201).json({ data });
}
exports.sendMessage = sendMessage;
// ─── DELETE MESSAGE ─────────────────────────────────────────────────────────
async function deleteMessage(req, res) {
    const userId = req.userId;
    const { messageId } = req.params;
    const { for_everyone } = req.body;
    const { data: msg } = await supabase_1.supabase
        .from('messages')
        .select('sender_id, created_at')
        .eq('id', messageId)
        .single();
    if (!msg)
        return res.status(404).json({ error: 'Message not found' });
    if (for_everyone) {
        // Only sender can delete for everyone, within 5 minutes
        if (msg.sender_id !== userId) {
            return res.status(403).json({ error: 'Only sender can delete for everyone' });
        }
        const elapsed = Date.now() - new Date(msg.created_at).getTime();
        if (elapsed > 5 * 60 * 1000) {
            return res.status(403).json({ error: '5-minute window has passed' });
        }
    }
    const { error } = await supabase_1.supabase
        .from('messages')
        .update({ is_deleted: true, content: null, image_url: null })
        .eq('id', messageId);
    if (error)
        return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
    return res.json({ success: true });
}
exports.deleteMessage = deleteMessage;
// ─── FORWARD MESSAGE ────────────────────────────────────────────────────────
async function forwardMessage(req, res) {
    const userId = req.userId;
    const { message_id, chat_ids } = req.body;
    if (!message_id || !chat_ids?.length) {
        return res.status(400).json({ error: 'message_id and chat_ids required' });
    }
    const { data: original } = await supabase_1.supabase
        .from('messages')
        .select('content, image_url')
        .eq('id', message_id)
        .single();
    if (!original)
        return res.status(404).json({ error: 'Original message not found' });
    const inserts = chat_ids.map((chatId) => ({
        chat_id: chatId,
        sender_id: userId,
        content: original.content,
        image_url: original.image_url,
        forwarded_from: message_id,
    }));
    const { error } = await supabase_1.supabase.from('messages').insert(inserts);
    if (error)
        return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
    return res.json({ success: true, forwarded_to: chat_ids.length });
}
exports.forwardMessage = forwardMessage;
// POST /messages/read  { messageIds: string[] }
// Batch-append the caller's id to each message's read_by array if it isn't
// already present. Idempotent and cheap — PostgREST's array_append via
// rpc isn't available, so we read each row, compute the next array, and
// write it back in a single bulk update.
async function batchMarkRead(req, res) {
    const userId = req.userId;
    const { messageIds } = req.body ?? {};
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
        return res.status(400).json({ error: 'messageIds array is required' });
    }
    // Pull the rows whose read_by doesn't already contain the caller.
    const { data: rows, error } = await supabase_1.supabase
        .from('messages')
        .select('id, read_by, sender_id')
        .in('id', messageIds);
    if (error)
        return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
    const updates = [];
    for (const r of rows ?? []) {
        if (r.sender_id === userId)
            continue; // never mark own messages
        const existing = Array.isArray(r.read_by) ? r.read_by : [];
        if (existing.includes(userId))
            continue;
        updates.push({ id: r.id, read_by: [...existing, userId] });
    }
    for (const u of updates) {
        await supabase_1.supabase.from('messages').update({ read_by: u.read_by }).eq('id', u.id);
    }
    return res.json({ success: true, updated: updates.length });
}
exports.batchMarkRead = batchMarkRead;
// ─── MARK AS READ ───────────────────────────────────────────────────────────
async function markAsRead(req, res) {
    const userId = req.userId;
    const { id } = req.params;
    // Verify participant
    const { data: participant } = await supabase_1.supabase
        .from('chat_participants')
        .select('id')
        .eq('chat_id', id)
        .eq('user_id', userId)
        .maybeSingle();
    if (!participant)
        return res.status(403).json({ error: 'Not a member of this chat' });
    // Get unread messages in this chat not sent by me
    const { data: unread } = await supabase_1.supabase
        .from('messages')
        .select('id, read_by')
        .eq('chat_id', id)
        .neq('sender_id', userId)
        .not('read_by', 'cs', `{${userId}}`);
    if (unread && unread.length > 0) {
        for (const msg of unread) {
            const readBy = [...(msg.read_by || []), userId];
            await supabase_1.supabase
                .from('messages')
                .update({ read_by: readBy })
                .eq('id', msg.id);
        }
    }
    return res.json({ success: true });
}
exports.markAsRead = markAsRead;
// ─── GET GROUP MEMBERS ──────────────────────────────────────────────────────
async function getGroupMembers(req, res) {
    const { id } = req.params;
    const { data, error } = await supabase_1.supabase
        .from('chat_participants')
        .select(`
      user_id, role, joined_at,
      user:users!user_id(id, full_name, username, profile_picture_url, is_premium)
    `)
        .eq('chat_id', id);
    if (error)
        return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
    return res.json({ data: data || [] });
}
exports.getGroupMembers = getGroupMembers;
// ─── REACT TO MESSAGE ───────────────────────────────────────────────────────
// PATCH /messages/:messageId/react  { emoji }
// Toggles the current user's reaction: if they already reacted with the
// given emoji it removes theirs, otherwise it adds. Reactions are stored
// in a JSONB column: { "👍": ["user-id-1", "user-id-2"], ... }
async function reactToMessage(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { messageId } = req.params;
        const { emoji } = req.body || {};
        if (!emoji)
            return res.status(400).json({ error: 'emoji is required' });
        const { data: msg, error } = await supabase_1.supabase
            .from('messages')
            .select('id, reactions')
            .eq('id', messageId)
            .maybeSingle();
        if (error || !msg)
            return res.status(404).json({ error: 'Message not found' });
        const reactions = msg.reactions ?? {};
        const current = reactions[emoji] ?? [];
        if (current.includes(userId)) {
            reactions[emoji] = current.filter((id) => id !== userId);
            if (reactions[emoji].length === 0)
                delete reactions[emoji];
        }
        else {
            reactions[emoji] = [...current, userId];
        }
        await supabase_1.supabase
            .from('messages')
            .update({ reactions })
            .eq('id', messageId);
        return res.json({ reactions });
    }
    catch {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.reactToMessage = reactToMessage;
//# sourceMappingURL=messages.controller.js.map