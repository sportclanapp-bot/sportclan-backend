import { deleteMatching } from '../utils/softDelete';
import { isRangeError, pageMeta, parsePagination } from '../utils/pagination';
import { Request, Response } from 'express';
import { isUuid } from '../utils/uuid';
import { supabase } from '../utils/supabase';
import { blockedUserIds, isBlockedBetween } from '../utils/blocks';
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
    rows.find((r) => r.status === 'declined' || r.status === 'accepted' || r.status === 'expired' || r.status === 'withdrawn');
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
export const INVITE_MESSAGE_MAX = 200;

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
  // SC-396: a malformed id reached the query and Postgres rejected the cast,
  // surfacing as a 500. A crash is not a guard — validate the shape first.
  if (!isUuid(receiver_id) || !isUuid(sport_id)) {
    return res.status(400).json({ error: 'receiver_id and sport_id must be valid ids', code: 'INVALID_ID' });
  }
  // Phase 3 B05-F10: the message is a short string (the app caps it at 200); an
  // object was stored and pushed as "[object Object]", and 3000 chars went out.
  if (message != null && typeof message !== 'string') {
    return res.status(400).json({ error: 'The message must be text.', code: 'BAD_MESSAGE' });
  }
  const cleanMessage = typeof message === 'string' ? message.trim() : '';
  if (cleanMessage.length > INVITE_MESSAGE_MAX) {
    return res.status(400).json({ error: `Keep the message under ${INVITE_MESSAGE_MAX} characters.`, code: 'MESSAGE_TOO_LONG' });
  }
  // An unknown receiver or sport failed the insert with a 500.
  const [{ data: receiver }, { data: sportRow }] = await Promise.all([
    supabase.from('users').select('id, deleted_at').eq('id', receiver_id).maybeSingle(),
    supabase.from('sports').select('id, is_active').eq('id', sport_id).maybeSingle(),
  ]);
  if (!receiver || (receiver as { deleted_at?: string | null }).deleted_at) {
    return res.status(404).json({ error: 'That player could not be found.', code: 'RECEIVER_NOT_FOUND' });
  }
  if (!sportRow || (sportRow as { is_active?: boolean | null }).is_active === false) {
    return res.status(400).json({ error: 'That sport isn’t available.', code: 'BAD_SPORT' });
  }

  // Block check — neither side may be blocking the other.
  // E-001 (Round 6): isBlockedBetween — the inline maybeSingle() let a mutual block through.
  if (await isBlockedBetween(userId, receiver_id)) return res.status(403).json({ error: 'Cannot invite a blocked user' });

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
      .update({ status: 'pending', responded_at: null, message: cleanMessage || null, created_at: nowIso })
      .eq('id', decision.id)
      .select(INVITE_COLS)
      .single();
    if (error || !data) return res.status(500).json({ error: sanitizeError(error) });
    invite = data;
  } else {
    const { data, error } = await supabase
      .from('invites')
      .insert({ sender_id: userId, receiver_id, sport_id, message: cleanMessage || null })
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

  try { await notifyInviteReceived(invite.id, userId, receiver_id, sport_id, cleanMessage || null); } catch { /* best-effort */ }
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
  // Guarded update: if the receiver responded between the read and here, 0 rows
  // change → clean 400 (race-safe), never a false success.
  // Profile & Settings tidy-up (migration 153): the row stays, marked 'withdrawn',
  // so the sender's Sent list can say so. Before 153 (no such status) it is
  // deleted and archived as before (audit #24).
  let deleted: string[] | null;
  const upd = await supabase.from('invites').update({ status: 'withdrawn', responded_at: new Date().toISOString() })
    .eq('id', id).eq('sender_id', userId).eq('status', 'pending').select('id');
  if (upd.error && (upd.error as { code?: string }).code === '23514') {
    const del = await deleteMatching('invites', (q) => q.eq('id', id).eq('sender_id', userId).eq('status', 'pending'), userId, 'withdrawn by its sender');
    if (del.error) return res.status(500).json({ error: sanitizeError({ message: del.error }) });
    deleted = del.ids;
  } else if (upd.error) {
    return res.status(500).json({ error: sanitizeError(upd.error) });
  } else {
    deleted = (upd.data ?? []).map((r: { id: string }) => r.id);
  }
  if (!deleted || deleted.length === 0) {
    return res.status(400).json({ error: 'This invite was already responded to.', code: 'INVITE_RESOLVED' });
  }
  // SC-332: remove the receiver's now-dangling invite notification so a withdrawn
  // invite doesn't linger in their bell (best-effort — never fail the withdraw).
  try {
    await deleteMatching('notifications', (q) => q.eq('user_id', invite.receiver_id).eq('type', 'invite').contains('data', { invite_id: id }), userId, 'invite withdrawn'); // audit #24
  } catch {
    /* best-effort */
  }
  return res.json({ success: true });
}

// GET /invites — invites received by current user
/** N-R7-S55: the invite's sender has deleted their account. */
function senderGone(inv: { sender?: { deleted_at?: string | null } | Array<{ deleted_at?: string | null }> | null }): boolean {
  const s = Array.isArray(inv.sender) ? inv.sender[0] : inv.sender;
  return !!s?.deleted_at;
}

export async function listInvites(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  // Oct 2026 sweep: the newest 50 were the whole list, and "N pending" was
  // counted from them. Now paged (limit / offset, has_more, total), with the
  // pending count from the database (fresh ones only — older are expired).
  const p = parsePagination(req.query as Record<string, unknown>, { defaultLimit: 50, maxLimit: 100 });
  // Profile & Settings tidy-up: ?box=sent — the invites YOU sent, each with its
  // status (waiting / accepted / declined / expired / withdrawn) and who it went to.
  if (req.query.box === 'sent') {
    const [{ data, error, count }, { count: waiting }] = await Promise.all([
      supabase
        .from('invites')
        .select('id, sender_id, receiver_id, sport_id, message, status, created_at, responded_at, receiver:receiver_id (id, name, username, profile_picture_url), sport:sport_id (id, name, emoji)', { count: 'exact' })
        .eq('sender_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(p.from, p.to),
      supabase.from('invites').select('id', { count: 'exact', head: true })
        .eq('sender_id', userId).eq('status', 'pending').gte('created_at', inviteFreshCutoffIso()),
    ]);
    if (error && !isRangeError(error)) return res.status(500).json({ error: sanitizeError(error) });
    const nowMs = Date.now();
    const invites = (data || []).map((inv: any) => (isInviteExpired(inv, nowMs) ? { ...inv, status: 'expired' } : inv));
    return res.json({ invites, pending_count: waiting ?? 0, ...pageMeta(count, p) });
  }
  const [{ data, error, count }, { data: pendingRows }] = await Promise.all([
    supabase
      .from('invites')
      .select('id, sender_id, receiver_id, sport_id, message, status, created_at, responded_at, sender:sender_id (id, name, username, profile_picture_url, deleted_at), sport:sport_id (id, name, emoji)', { count: 'exact' })
      .eq('receiver_id', userId)
      // A withdrawn invite was deleted before migration 153; it stays out of the receiver's list.
      .neq('status', 'withdrawn')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(p.from, p.to),
    // N-R7-S55: the fresh pending ones' senders (a few at most), so the count leaves out the hidden ones.
    supabase.from('invites').select('sender_id, sender:sender_id (deleted_at)')
      .eq('receiver_id', userId).eq('status', 'pending').gte('created_at', inviteFreshCutoffIso()),
  ]);
  if (error && !isRangeError(error)) return res.status(500).json({ error: sanitizeError(error) });
  // N-R7-S55: invites from a blocked account (either way) or a deleted one leave the list.
  const blocked = await blockedUserIds(userId);
  const offered = (inv: any) => !blocked.has(inv.sender_id) && !senderGone(inv);
  // SC-332: a >48h-old pending invite is surfaced as 'expired' (not actionable),
  // whether or not the hygiene sweep has flipped its stored status yet.
  const nowMs = Date.now();
  const invites = (data || []).filter(offered).map((inv: any) =>
    isInviteExpired(inv, nowMs) ? { ...inv, status: 'expired' } : inv,
  );
  const pending = ((pendingRows as any[] | null) ?? []).filter(offered).length;
  return res.json({ invites, pending_count: pending, ...pageMeta(count, p) });
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

/**
 * F049 (launch test plan): an invite the sender withdrew answered 'You already
 * answered this invite.' — the receiver hadn't. It says it was withdrawn now
 * (INVITE_WITHDRAWN), so the app can drop it from the pending list.
 */
export function notPendingRefusal(status: string | null | undefined): { error: string; code: string } {
  if (status === 'withdrawn') return { error: 'They withdrew this invite.', code: 'INVITE_WITHDRAWN' };
  if (status === 'expired') return { error: 'This invite has expired.', code: 'INVITE_EXPIRED' };
  return { error: 'You already answered this invite.', code: 'INVITE_RESOLVED' };
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
    .select('created_at, status, receiver_id, sender_id, sender:sender_id (deleted_at)')
    .eq('id', id)
    .maybeSingle();
  if (!existing || existing.receiver_id !== userId) {
    return res.status(404).json({ error: 'Invite not found' });
  }
  // N-R7-S55: an invite from someone blocked (either way) or a deleted account is no longer
  // offered, so it can't be accepted (a decline is harmless and still allowed).
  if (status === 'accepted' && (senderGone(existing) || await isBlockedBetween(userId, (existing as { sender_id: string }).sender_id))) {
    return res.status(403).json({ error: 'This invite is no longer available.', code: 'INVITE_UNAVAILABLE' });
  }
  if (isInviteExpired(existing, Date.now())) {
    return res.status(400).json({ error: 'This invite has expired.', code: 'INVITE_EXPIRED' });
  }
  // Phase 3 B05-F9: an invite is answered once. Accept → decline → accept all
  // returned 200 and notified the sender each time.
  if (existing.status !== 'pending') return res.status(409).json(notPendingRefusal(existing.status));
  const { data, error } = await supabase
    .from('invites')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('id', id)
    .eq('receiver_id', userId)
    .eq('status', 'pending')
    .select('id, status, sender_id, sport_id')
    .maybeSingle();
  if (error) return res.status(500).json({ error: sanitizeError(error) });
  // Lost a race — with another answer from the same person, or the sender
  // withdrawing it (F049): say which.
  if (!data) {
    const { data: now } = await supabase.from('invites').select('status').eq('id', id).maybeSingle();
    return res.status(409).json(notPendingRefusal((now as { status?: string } | null)?.status));
  }

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
