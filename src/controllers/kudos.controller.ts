import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { notifyUser } from '../utils/notify';

const KUDOS_COINS = 2;

// POST /kudos  { toUserId, matchId, message? }
//
// Rules:
//   * Sender and recipient must both be participants of the match
//   * Sender cannot send kudos to themselves
//   * Only one kudos per sender+recipient+match (DB unique constraint OR
//     a pre-insert existence check here)
// On success we award 2 coins to the recipient and push them a notification.
export async function sendKudos(req: Request, res: Response) {
  const senderId = req.userId;
  if (!senderId) return res.status(401).json({ error: 'Unauthorized' });

  const { toUserId, matchId, message } = req.body ?? {};
  if (!toUserId || !matchId) {
    return res.status(400).json({ error: 'toUserId and matchId are required' });
  }
  if (toUserId === senderId) {
    return res.status(400).json({ error: 'Cannot send kudos to yourself' });
  }

  // Validate both users participated in this match.
  const { data: participants } = await supabase
    .from('match_participants')
    .select('user_id')
    .eq('match_id', matchId)
    .in('user_id', [senderId, toUserId]);
  const ids = new Set((participants ?? []).map((p) => p.user_id));
  if (!ids.has(senderId) || !ids.has(toUserId)) {
    return res.status(403).json({ error: 'Both users must be match participants' });
  }

  // Idempotency — if we've already sent for this match, just return the
  // existing row.
  const { data: existing } = await supabase
    .from('kudos')
    .select('*')
    .eq('from_user_id', senderId)
    .eq('to_user_id', toUserId)
    .eq('match_id', matchId)
    .maybeSingle();
  if (existing) {
    return res.json({ kudos: existing, alreadySent: true });
  }

  const { data: inserted, error } = await supabase
    .from('kudos')
    .insert({
      from_user_id: senderId,
      to_user_id: toUserId,
      match_id: matchId,
      message: message?.toString()?.slice(0, 200) ?? null,
    })
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  // Award coins on the recipient's user row.
  try {
    const { data: usr } = await supabase
      .from('users')
      .select('coin_balance')
      .eq('id', toUserId)
      .maybeSingle();
    if (usr) {
      await supabase
        .from('users')
        .update({ coin_balance: (usr.coin_balance ?? 0) + KUDOS_COINS })
        .eq('id', toUserId);
    }
    await supabase.from('transactions').insert({
      user_id: toUserId,
      type: 'kudos',
      coins: KUDOS_COINS,
      description: 'Received kudos',
      reference_id: inserted.id,
      status: 'completed',
    });
  } catch {
    // best-effort
  }

  // Push + in-app notification.
  try {
    const { data: senderRow } = await supabase
      .from('users')
      .select('name')
      .eq('id', senderId)
      .maybeSingle();
    const senderName = senderRow?.name ?? 'Someone';
    void notifyUser({
      userId: toUserId,
      type: 'kudos',
      title: '\uD83D\uDC4F Kudos!',
      body: `${senderName} gave you kudos (+${KUDOS_COINS} coins)`,
      data: { matchId, screen: 'MatchDetail' },
    });
  } catch {
    // swallow
  }

  return res.json({ kudos: inserted, alreadySent: false });
}

// GET /kudos/received/:userId — list recent kudos for the given user,
// paginated to the most recent 50. Public; no auth scope needed.
export async function listReceivedKudos(req: Request, res: Response) {
  const { userId } = req.params;
  const { data, error } = await supabase
    .from('kudos')
    .select('id, match_id, message, created_at, from_user_id, sender:users!from_user_id(id, name, username, profile_picture_url)')
    .eq('to_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ kudos: data ?? [] });
}

// GET /kudos/count/:userId — total received count (used in Profile stat row).
export async function getKudosCount(req: Request, res: Response) {
  const { userId } = req.params;
  const { count, error } = await supabase
    .from('kudos')
    .select('id', { count: 'exact', head: true })
    .eq('to_user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ count: count ?? 0 });
}
