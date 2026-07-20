import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { notifyUnlessBlocked, notifyUser } from '../utils/notify';

// SC-332: play invites auto-expire 48h after created_at. Freshness is the SOURCE
// OF TRUTH and works WITHOUT cron — every read + the dedup guard treat a pending
// invite older than this as expired, so the sender's button auto-frees even before
// the hygiene sweep flips the row's stored status.
export const INVITE_TTL_MS = 48 * 60 * 60 * 1000;
export function inviteFreshCutoffIso(): string {
  return new Date(Date.now() - INVITE_TTL_MS).toISOString();
}

type InviteRowLite = { id: string; status: string; created_at: string };

/** A pending invite is only "active" while it's younger than the TTL. */
export function isInviteActivePending(row: { status: string; created_at: string }, nowMs: number): boolean {
  return row.status === 'pending' && Date.parse(row.created_at) >= nowMs - INVITE_TTL_MS;
}

/** True once a pending invite has aged past the TTL (expired-by-freshness), or its
 *  stored status is already 'expired'. */
export function isInviteExpired(row: { status: string; created_at: string }, nowMs: number): boolean {
  if (row.status === 'expired') return true;
  return row.status === 'pending' && Date.parse(row.created_at) < nowMs - INVITE_TTL_MS;
}

export type InviteDedup =
  | { action: 'already_invited' }
  | { action: 'reuse'; id: string }
  | { action: 'insert' };

/**
 * Decide what createInvite should do given the existing (sender, receiver, sport)
 * rows. Pure + time-injected so the 48h boundary is unit-testable without a live
 * 48h wait or DB backdating:
 *   - a FRESH pending row  → already_invited (dedup)
 *   - a STALE pending row  → reuse (refresh it in place; keeps uq_invites_pending)
 *   - only resolved rows   → reuse the newest (reopen)
 *   - nothing              → insert
 */
export function decideInviteDedup(rows: InviteRowLite[], nowMs: number): InviteDedup {
  const pending = rows.find((r) => r.status === 'pending'); // at most one (uq index)
  if (pending && isInviteActivePending(pending, nowMs)) {
    return { action: 'already_invited' };
  }
  const reuse =
    pending ??
    rows.find((r) => r.status === 'declined' || r.status === 'accepted' || r.status === 'expired');
  return reuse ? { action: 'reuse', id: reuse.id } : { action: 'insert' };
}

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
  // SC-222: route through notifyUser so the Social toggle is respected (the
  // direct insert + push here bypassed allowedRecipients). notifyUser handles
  // the pref gate, the notifications row, AND the push in one call.
  await notifyUser({
    userId: receiverId,
    type: 'invite',
    title: `${senderHandle} sent you a play invite`,
    body: `For ${sportLabel}${message ? ` — "${message}"` : ''}`,
    data: { invite_id: inviteId, sport_id: sportId, sender_id: senderId },
  });
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
  // (accepted/declined/expired) invite is REOPENED; a FRESH pending one is a clean
  // 400; a STALE (>48h) pending one is refreshed IN PLACE — never a duplicate row.
  const { data: existingRows } = await supabase
    .from('invites')
    .select('id, status, created_at')
    .eq('sender_id', userId)
    .eq('receiver_id', receiver_id)
    .eq('sport_id', sport_id)
    .order('created_at', { ascending: false });
  const rows = existingRows || [];
  const decision = decideInviteDedup(rows, Date.now());
  if (decision.action === 'already_invited') {
    return res.status(400).json({
      error: 'You already have a pending invite to this player for this sport.',
      code: 'ALREADY_INVITED',
    });
  }

  let invite: any;
  const nowIso = new Date().toISOString();
  if (decision.action === 'reuse') {
    // Refresh a stale pending row / reopen a resolved one — concurrent reuses all
    // target the same id, so uq_invites_pending is never violated.
    const { data, error } = await supabase
      .from('invites')
      .update({ status: 'pending', responded_at: null, message: message || null, created_at: nowIso })
      .eq('id', decision.id)
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
    .from('invites').select('id, sender_id, receiver_id, status').eq('id', id).maybeSingle();
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
  // SC-332: remove the receiver's now-dangling invite notification so a withdrawn
  // invite doesn't linger in their bell (best-effort — never fail the withdraw).
  try {
    await supabase
      .from('notifications')
      .delete()
      .eq('user_id', invite.receiver_id)
      .eq('type', 'invite')
      .contains('data', { invite_id: id });
  } catch {
    /* best-effort */
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
  // SC-332: a >48h-old pending invite is surfaced as 'expired' (not actionable),
  // whether or not the hygiene sweep has flipped its stored status yet.
  const nowMs = Date.now();
  const invites = (data || []).map((inv: any) =>
    isInviteExpired(inv, nowMs) ? { ...inv, status: 'expired' } : inv,
  );
  return res.json({ invites });
}

// SC-332: hygiene sweep — flip stale PENDING invites to 'expired'. NOT required for
// correctness (freshness is enforced on every read + the dedup guard); this only
// makes the stored status honest. Idempotent. Wired to POST /jobs/expire-invites
// (cron-gated), which activates when CRON_SECRET is set at launch.
export async function sweepExpiredInvites(): Promise<{ expired: number }> {
  const cutoff = inviteFreshCutoffIso();
  const { data } = await supabase
    .from('invites')
    .select('id')
    .eq('status', 'pending')
    .lt('created_at', cutoff);
  const ids = (data || []).map((r: any) => r.id);
  if (ids.length) {
    await supabase
      .from('invites')
      .update({ status: 'expired', responded_at: new Date().toISOString() })
      .in('id', ids);
  }
  return { expired: ids.length };
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
  // SC-332: can't act on an expired invite. A pending row older than 48h is expired
  // even if the sweep hasn't flipped its stored status yet.
  const { data: existing } = await supabase
    .from('invites')
    .select('created_at, status, receiver_id')
    .eq('id', id)
    .maybeSingle();
  if (!existing || existing.receiver_id !== userId) {
    return res.status(404).json({ error: 'Invite not found' });
  }
  if (isInviteExpired(existing, Date.now())) {
    return res.status(400).json({ error: 'This invite has expired.', code: 'INVITE_EXPIRED' });
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
