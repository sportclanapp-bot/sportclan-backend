import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { sendPushToTokens } from '../utils/fcm';
import { notifyUnlessBlocked } from '../utils/notify';

// POST /invites  { receiver_id, sport_id, message? }
// Best-effort receiver notification — shared by a fresh invite and a re-send.
async function notifyInviteReceived(
  inviteId: string, senderId: string, receiverId: string, sportId: string, message: string | null,
): Promise<void> {
  const [{ data: sender }, { data: sport }] = await Promise.all([
    supabase.from('users').select('name, username').eq('id', senderId).maybeSingle(),
    supabase.from('sports').select('name, emoji').eq('id', sportId).maybeSingle(),
  ]);
  const senderHandle = sender?.username ? `@${sender.username}` : sender?.name ?? 'Someone';
  const sportLabel = sport ? `${sport.emoji} ${sport.name}` : 'a match';
  await supabase.from('notifications').insert({
    user_id: receiverId,
    type: 'invite',
    title: `${senderHandle} sent you a play invite`,
    body: `For ${sportLabel}${message ? ` — "${message}"` : ''}`,
    data: { invite_id: inviteId, sport_id: sportId, sender_id: senderId },
  });
  const { data: tokens } = await supabase.from('push_tokens').select('token').eq('user_id', receiverId);
  if (tokens && tokens.length > 0) {
    await sendPushToTokens(tokens.map((t: any) => t.token), {
      title: `${senderHandle} wants to play`,
      body: `${sportLabel}${message ? ` — ${message}` : ''}`,
      data: { type: 'invite', invite_id: inviteId },
    });
  }
}

const INVITE_COLS = 'id, sender_id, receiver_id, sport_id, message, status, created_at';

export async function createInvite(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { receiver_id, sport_id, message } = req.body || {};
  if (!receiver_id || !sport_id) {
    return res.status(400).json({ error: 'receiver_id and sport_id are required' });
  }
  if (receiver_id === userId) {
    return res.status(400).json({ error: 'Cannot invite yourself' });
  }

  // Block check — neither side may be blocking the other.
  const { data: block } = await supabase
    .from('user_blocks')
    .select('id')
    .or(`and(blocker_id.eq.${userId},blocked_id.eq.${receiver_id}),and(blocker_id.eq.${receiver_id},blocked_id.eq.${userId})`)
    .maybeSingle();
  if (block) return res.status(403).json({ error: 'Cannot invite a blocked user' });

  // DEDUP: one PENDING invite per (sender, receiver, sport). A resolved
  // (accepted/declined) invite is REOPENED to pending; a live pending one is a
  // clean 400 — never a duplicate row.
  const { data: existingRows } = await supabase
    .from('invites')
    .select('id, status')
    .eq('sender_id', userId)
    .eq('receiver_id', receiver_id)
    .eq('sport_id', sport_id)
    .order('created_at', { ascending: false });
  const rows = existingRows || [];
  if (rows.some((r) => r.status === 'pending')) {
    return res.status(400).json({
      error: 'You already have a pending invite to this player for this sport.',
      code: 'ALREADY_INVITED',
    });
  }
  const resolved = rows.find((r) => r.status === 'declined' || r.status === 'accepted');

  let invite: any;
  const nowIso = new Date().toISOString();
  if (resolved) {
    // Reopen this exact row — concurrent reopens all target the same id, so no dup.
    const { data, error } = await supabase
      .from('invites')
      .update({ status: 'pending', responded_at: null, message: message || null, created_at: nowIso })
      .eq('id', resolved.id)
      .select(INVITE_COLS)
      .single();
    if (error || !data) return res.status(500).json({ error: sanitizeError(error) });
    invite = data;
  } else {
    const { data, error } = await supabase
      .from('invites')
      .insert({ sender_id: userId, receiver_id, sport_id, message: message || null })
      .select(INVITE_COLS)
      .single();
    if (error) {
      // Race backstop (partial unique index uq_invites_pending): a concurrent
      // first-time invite inserted first → already-invited, never a raw 500.
      const code = (error as { code?: string }).code;
      if (code === '23505' || /duplicate|unique/i.test(error.message || '')) {
        return res.status(400).json({
          error: 'You already have a pending invite to this player for this sport.',
          code: 'ALREADY_INVITED',
        });
      }
      return res.status(500).json({ error: sanitizeError(error) });
    }
    invite = data;
  }

  try { await notifyInviteReceived(invite.id, userId, receiver_id, sport_id, message || null); } catch { /* best-effort */ }
  return res.json({ invite });
}

// DELETE /invites/:id — the SENDER withdraws their own PENDING invite. Silent
// removal (the row is deleted; the receiver's copy simply vanishes). Only the
// sender, only while pending; accepted/declined can't be withdrawn.
export async function withdrawInvite(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  const { data: invite } = await supabase
    .from('invites').select('id, sender_id, status').eq('id', id).maybeSingle();
  if (!invite) return res.status(404).json({ error: 'Invite not found' });
  if (invite.sender_id !== userId) {
    return res.status(403).json({ error: 'Only the sender can withdraw this invite' });
  }
  if (invite.status !== 'pending') {
    return res.status(400).json({ error: 'Only a pending invite can be withdrawn.', code: 'INVITE_RESOLVED' });
  }
  // Guarded delete: if the receiver responded between the read and here, 0 rows
  // delete → clean 400 (race-safe), never a false success.
  const { data: deleted, error } = await supabase
    .from('invites').delete()
    .eq('id', id).eq('sender_id', userId).eq('status', 'pending')
    .select('id');
  if (error) return res.status(500).json({ error: sanitizeError(error) });
  if (!deleted || deleted.length === 0) {
    return res.status(400).json({ error: 'This invite was already responded to.', code: 'INVITE_RESOLVED' });
  }
  return res.json({ success: true });
}

// GET /invites — invites received by current user
export async function listInvites(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { data, error } = await supabase
    .from('invites')
    .select('id, sender_id, receiver_id, sport_id, message, status, created_at, responded_at, sender:sender_id (id, name, username, profile_picture_url), sport:sport_id (id, name, emoji)')
    .eq('receiver_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: sanitizeError(error) });
  return res.json({ invites: data || [] });
}

// PATCH /invites/:id  { status: 'accepted' | 'declined' }
export async function respondToInvite(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  const { status } = req.body || {};
  if (!['accepted', 'declined'].includes(status)) {
    return res.status(400).json({ error: 'status must be accepted or declined' });
  }
  const { data, error } = await supabase
    .from('invites')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('id', id)
    .eq('receiver_id', userId)
    .select('id, status, sender_id, sport_id')
    .single();
  if (error || !data) return res.status(404).json({ error: error?.message || 'Invite not found' });

  // Notify the SENDER that their invite was accepted/declined (block-respecting,
  // best-effort — never fail the response).
  try {
    const { data: responder } = await supabase
      .from('users').select('name, username').eq('id', userId).maybeSingle();
    const handle = responder?.username ? `@${responder.username}` : responder?.name ?? 'Someone';
    const accepted = status === 'accepted';
    await notifyUnlessBlocked(userId, {
      userId: data.sender_id,
      type: accepted ? 'invite_accepted' : 'invite_declined',
      title: accepted ? `${handle} accepted your play invite` : `${handle} declined your play invite`,
      body: accepted ? 'Tap to view their profile and set up a match.' : '',
      data: { actorId: userId, invite_id: data.id, sport_id: data.sport_id },
    });
  } catch {
    // best-effort
  }
  return res.json({ invite: { id: data.id, status: data.status } });
}
