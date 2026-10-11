import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { notifyUser } from '../utils/notify';
import { consentedParticipants } from '../utils/matchConsent';
import { excludeDeletedEmbed } from '../utils/activeUser';
import { blockedUserIds, excludeIds, isBlockedBetween, targetUserHidden } from '../utils/blocks';

const KUDOS_COINS = 2;
/** Audit #12: one paid kudos per sender → receiver a week. */
export const KUDOS_COIN_WINDOW_MS = 7 * 24 * 3600 * 1000;

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
  // SC-96: block gate — a blocked user can't send kudos (which awards the
  // recipient coins + a notification) to the person they're blocked with.
  if (await isBlockedBetween(senderId, toUserId)) {
    return res.status(403).json({ error: 'You can’t send kudos to this user.' });
  }

  // Audit #12: only a finished match that counts, and only between players who
  // agreed to play it (audit #6) — a self-made match with a second account
  // farmed coins.
  const { data: match } = await supabase
    .from('matches')
    .select('id, status, voided_at, created_by, tournament_id, team_a_id, team_b_id')
    .eq('id', matchId)
    .maybeSingle();
  if (!match || match.status !== 'completed' || match.voided_at) {
    return res.status(409).json({ error: 'Kudos are for a finished match.', code: 'MATCH_NOT_FINISHED' });
  }
  // Validate both users participated in this match.
  const { data: participants } = await supabase
    .from('match_participants')
    .select('user_id, team_side')
    .eq('match_id', matchId)
    .in('user_id', [senderId, toUserId]);
  const ids = new Set((participants ?? []).map((p) => p.user_id));
  if (!ids.has(senderId) || !ids.has(toUserId)) {
    return res.status(403).json({ error: 'Both users must be match participants' });
  }
  const agreed = new Set((await consentedParticipants(match as any, (participants ?? []) as Array<{ user_id: string; team_side: string }>)).map((p) => p.user_id));
  if (!agreed.has(senderId) || !agreed.has(toUserId)) {
    return res.status(403).json({ error: 'Kudos are between players who agreed to play this match.', code: 'NOT_CONFIRMED_PLAYERS' });
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
  // SC-116: concurrent double-send loses the unique race (mig 048 uq_kudos_from_
  // to_match). The winner already inserted + credited coins — return the same
  // idempotent { alreadySent } as the pre-check, and (critically) return BEFORE
  // the coin-credit below so we never double-credit.
  if ((error as { code?: string } | null)?.code === '23505') {
    const { data: existingRow } = await supabase
      .from('kudos')
      .select('*')
      .eq('from_user_id', senderId)
      .eq('to_user_id', toUserId)
      .eq('match_id', matchId)
      .maybeSingle();
    return res.json({ kudos: existingRow, alreadySent: true });
  }
  if (error) return res.status(500).json({ error: sanitizeError(error) });

  /**
   * SC-434 · award the coins through the LEDGER, like every other coin change.
   *
   * This used to read coin_balance, add 2, and write it back — a read-modify-write
   * with no ledger row in coin_events, which had two consequences. Two kudos
   * landing at once could each read the same balance and one credit would
   * disappear (the A4-006 drift that `increment_coins` exists to prevent). And
   * coin_events did not add up to the balance, so the coin history could not be
   * reconciled against it.
   *
   * `awardCoins` fixes both: the (user, event_type) unique key makes it idempotent
   * per kudos, the increment is atomic in Postgres, and it writes the transactions
   * row itself. The key is the kudos id, so a retry of the same kudos credits once
   * while a second kudos from a different teammate credits again — which is the
   * existing rule, now enforced by the database rather than by luck.
   */
  // Audit #12: coins at most once a week from the same sender to the same
  // person (more kudos still count, they just don't pay again).
  let paid = false;
  try {
    const since = new Date(Date.now() - KUDOS_COIN_WINDOW_MS).toISOString();
    const { count: recent } = await supabase
      .from('kudos')
      .select('id', { count: 'exact', head: true })
      .eq('from_user_id', senderId)
      .eq('to_user_id', toUserId)
      .neq('id', inserted.id)
      .gte('created_at', since);
    if (!recent) {
      const { awardCoins } = await import('../utils/coins');
      await awardCoins(toUserId, `kudos_${inserted.id}`, KUDOS_COINS, 'Received kudos');
      paid = true;
    }
  } catch {
    // best-effort — the kudos itself is already recorded
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
      body: paid ? `${senderName} gave you kudos (+${KUDOS_COINS} coins)` : `${senderName} gave you kudos`,
      data: { matchId, screen: 'MatchDetail' },
    });
  } catch {
    // swallow
  }

  return res.json({ kudos: inserted, alreadySent: false, coins: paid ? KUDOS_COINS : 0 });
}

// GET /kudos/received/:userId — list recent kudos for the given user,
// paginated to the most recent 50. Public; no auth scope needed.
export async function listReceivedKudos(req: Request, res: Response) {
  const { userId } = req.params;
  // B04-F2: hidden like the profile itself when the target is deleted or blocked.
  if (await targetUserHidden(userId, req.userId)) return res.status(404).json({ error: 'User not found' });
  // SC-77: hide kudos by a soft-deleted account. Block edge: hide kudos sent by
  // anyone the viewer (req.userId — route is authed) has blocked either direction.
  const blocked = await blockedUserIds(req.userId);
  const { data, error } = await excludeIds(excludeDeletedEmbed(supabase
    .from('kudos')
    .select('id, match_id, message, created_at, from_user_id, sender:users!from_user_id!inner(id, name, username, profile_picture_url)')
    .eq('to_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50), 'sender'), 'from_user_id', blocked);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ kudos: data ?? [] });
}

// GET /kudos/count/:userId — total received count (used in Profile stat row).
export async function getKudosCount(req: Request, res: Response) {
  const { userId } = req.params;
  // B04-F2: hidden like the profile itself when the target is deleted or blocked.
  if (await targetUserHidden(userId, req.userId)) return res.status(404).json({ error: 'User not found' });
  // B04-F16: the same exclusions as the list (deleted senders, blocked either
  // way), so the count on the Profile row can't exceed the list it opens.
  const blocked = await blockedUserIds(req.userId);
  const { count, error } = await excludeIds(excludeDeletedEmbed(supabase
    .from('kudos')
    .select('id, sender:users!from_user_id!inner(id)', { count: 'exact', head: true })
    .eq('to_user_id', userId), 'sender'), 'from_user_id', blocked);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ count: count ?? 0 });
}
