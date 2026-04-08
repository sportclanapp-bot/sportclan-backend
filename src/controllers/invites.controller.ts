import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sendPushToTokens } from '../utils/fcm';

// POST /invites  { receiver_id, sport_id, message? }
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

  const { data: invite, error } = await supabase
    .from('invites')
    .insert({ sender_id: userId, receiver_id, sport_id, message: message || null })
    .select('id, sender_id, receiver_id, sport_id, message, status, created_at')
    .single();
  if (error || !invite) return res.status(500).json({ error: error?.message || 'Failed to create invite' });

  // Best-effort: write a notification + push to receiver.
  const [{ data: sender }, { data: sport }] = await Promise.all([
    supabase.from('users').select('name, username').eq('id', userId).maybeSingle(),
    supabase.from('sports').select('name, emoji').eq('id', sport_id).maybeSingle(),
  ]);
  const senderHandle = sender?.username ? `@${sender.username}` : sender?.name ?? 'Someone';
  const sportLabel = sport ? `${sport.emoji} ${sport.name}` : 'a match';

  await supabase.from('notifications').insert({
    user_id: receiver_id,
    type: 'invite',
    title: `${senderHandle} sent you a play invite`,
    body: `For ${sportLabel}${message ? ` — "${message}"` : ''}`,
    data: { invite_id: invite.id, sport_id, sender_id: userId },
  });

  const { data: tokens } = await supabase
    .from('push_tokens').select('token').eq('user_id', receiver_id);
  if (tokens && tokens.length > 0) {
    await sendPushToTokens(
      tokens.map((t: any) => t.token),
      {
        title: `${senderHandle} wants to play`,
        body: `${sportLabel}${message ? ` — ${message}` : ''}`,
        data: { type: 'invite', invite_id: invite.id },
      },
    );
  }

  return res.json({ invite });
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
  if (error) return res.status(500).json({ error: error.message });
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
    .select('id, status')
    .single();
  if (error || !data) return res.status(404).json({ error: error?.message || 'Invite not found' });
  return res.json({ invite: data });
}
