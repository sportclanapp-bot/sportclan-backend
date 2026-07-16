import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { notifyUsers } from '../utils/notify';
import { blockedUserIds } from '../utils/blocks';
import { isUuid } from '../utils/uuid';
import { excludeDeletedEmbed } from '../utils/activeUser';
import { sanitizeError } from '../utils/response';

// SC-279: match join request/approve — the match mirror of the team pattern
// (SC-267 / migration 065). Casual OPEN matches only (tournament fixtures are
// never open-joinable). Mirrors Z-4 where it fits and DIVERGES where matches
// differ (capacity + time-sensitivity):
//  • pending requests hold NO slot — approval IS an atomic gated instant-join
//    via the existing join_open_match RPC (039), so over-approval is
//    structurally impossible (SC-59's cap enforces itself).
//  • no expiry job — three guards: request-time (only while joinable),
//    approve-time (the RPC re-checks under the lock → not_open/full), and
//    listing scoped to actionable (pending + match still scheduled). A stale
//    pending row is inert.
//  • block-gated at BOTH request and approve (a block can land between).
//  • a REJECTION is terminal for this match (no re-request, no 24h timer — a
//    one-off game's rejection is its whole lifetime); a WITHDRAWAL can re-request.
//  • notifs are ungated (join responsibilities); the creator (only) approves.

async function sportLabel(sportId: string | null | undefined): Promise<string> {
  if (!sportId) return 'match';
  const { data } = await supabase.from('sports').select('name').eq('id', sportId).maybeSingle();
  return data?.name ? `${data.name} match` : 'match';
}

// POST /matches/:id/join-requests — request to join an approval match.
export async function requestToJoinMatch(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid match id' });

    const { data: match } = await supabase
      .from('matches')
      .select('id, created_by, status, is_open, players_needed, join_policy, tournament_id, sport_id')
      .eq('id', id).maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });

    // Scope: casual open matches only. Tournament fixtures aren't request-joinable
    // (belt-and-suspenders — they're never is_open either).
    if (match.tournament_id) {
      return res.status(400).json({ error: 'Tournament fixtures aren’t open to join requests.' });
    }
    if (match.join_policy !== 'approval') {
      return res.status(409).json({ error: 'This match allows instant join — no request needed.', code: 'OPEN_JOIN' });
    }
    if (match.created_by === userId) {
      return res.status(400).json({ error: 'You created this match.' });
    }

    // Time/capacity guard (request-time): only while genuinely joinable.
    if (match.status !== 'scheduled') {
      return res.status(409).json({ error: 'This match has already started or finished.', code: 'MATCH_NOT_JOINABLE' });
    }
    if (!match.is_open || (match.players_needed ?? 0) <= 0) {
      return res.status(409).json({ error: 'This match is full.', code: 'MATCH_FULL' });
    }

    // Already a participant?
    const { data: part } = await supabase
      .from('match_participants').select('id').eq('match_id', id).eq('user_id', userId).maybeSingle();
    if (part) return res.status(409).json({ error: 'You’re already in this match.' });

    // Block gate (both ends) — blocked either-direction with the creator OR any
    // participant can't join a shared match space.
    const blocked = await blockedUserIds(userId);
    if (blocked.size > 0) {
      const { data: parts } = await supabase.from('match_participants').select('user_id').eq('match_id', id);
      const others = new Set<string>([
        ...(match.created_by ? [match.created_by as string] : []),
        ...((parts ?? []).map((p) => p.user_id as string)),
      ]);
      if ([...others].some((uid) => blocked.has(uid))) {
        return res.status(403).json({ error: 'You can’t join this match.', code: 'BLOCKED_FROM_MATCH' });
      }
    }

    // One row per (match,user). Re-request rules diverge from teams:
    //   pending   → dup (409)
    //   rejected  → terminal for THIS match (403, no timer, no re-request)
    //   withdrawn → allowed → flip the same row back to pending
    //   approved  → already in (caught by the participant check above)
    const { data: prior } = await supabase
      .from('match_join_requests').select('id, status')
      .eq('match_id', id).eq('user_id', userId).maybeSingle();
    if (prior) {
      if (prior.status === 'pending') {
        return res.status(409).json({ error: 'You already have a pending request to join this match.' });
      }
      if (prior.status === 'rejected') {
        return res.status(403).json({ error: 'Your request to join this match was declined.', code: 'REQUEST_DECLINED' });
      }
      const { error } = await supabase.from('match_join_requests')
        .update({ status: 'pending', requested_at: new Date().toISOString(), decided_by: null, decided_at: null })
        .eq('id', prior.id);
      if (error) return res.status(500).json({ error: sanitizeError(error) });
    } else {
      const { error } = await supabase.from('match_join_requests')
        .insert({ match_id: id, user_id: userId, status: 'pending' });
      if ((error as { code?: string } | null)?.code === '23505') {
        return res.status(409).json({ error: 'You already have a pending request to join this match.' });
      }
      if (error) return res.status(500).json({ error: sanitizeError(error) });
    }

    // Notify the creator (single recipient) — ungated.
    try {
      const { data: requester } = await supabase.from('users').select('name').eq('id', userId).maybeSingle();
      const sport = await sportLabel(match.sport_id as string | null);
      void notifyUsers([match.created_by as string], {
        type: 'match_join_request',
        title: 'New join request',
        body: `${requester?.name ?? 'A player'} wants to join your ${sport}.`,
        data: { matchId: id, screen: 'MatchDetail' },
      }, { actorId: userId });
    } catch { /* best-effort */ }

    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /matches/:id/join-requests — the creator sees pending, actionable requests.
export async function listMatchJoinRequests(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid match id' });
    const { data: match } = await supabase
      .from('matches').select('created_by, status').eq('id', id).maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.created_by !== userId) {
      return res.status(403).json({ error: 'Only the match creator can view join requests.' });
    }
    // Scoped to actionable: a started/finished match's pending rows are inert.
    if (match.status !== 'scheduled') return res.json({ requests: [] });

    const { data } = await excludeDeletedEmbed(supabase
      .from('match_join_requests')
      .select('id, user_id, status, requested_at, user:user_id!inner (id, name, username, profile_picture_url)')
      .eq('match_id', id)
      .eq('status', 'pending')
      .order('requested_at', { ascending: true }), 'user');
    return res.json({ requests: data ?? [] });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PATCH /matches/:id/join-requests/:userId  { status: 'approved' | 'rejected' }
export async function decideMatchJoinRequest(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    const targetUserId = String(req.params.userId);
    const { status } = req.body || {};
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid match id' });
    if (!isUuid(targetUserId)) return res.status(400).json({ error: 'Invalid user id' });
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
    }

    const { data: match } = await supabase
      .from('matches').select('created_by, sport_id, status').eq('id', id).maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    // Creator only — NOT the umpire (who plays is structural, not officiating).
    if (match.created_by !== userId) {
      return res.status(403).json({ error: 'Only the match creator can decide join requests.' });
    }

    const { data: reqRow } = await supabase
      .from('match_join_requests').select('id, status')
      .eq('match_id', id).eq('user_id', targetUserId).maybeSingle();
    if (!reqRow || reqRow.status !== 'pending') {
      return res.status(404).json({ error: 'No pending request from this user.' });
    }

    if (status === 'approved') {
      // SC-280: you can't add a player to a match that has already started. The
      // join_open_match RPC only rejects completed/cancelled (a 'live' match is
      // still slot-joinable by design), so the started-match guard lives HERE —
      // a stale pending request on a now-live match stays pending (inert), it is
      // not silently approved onto an in-progress game. (Reject stays allowed.)
      if (match.status !== 'scheduled') {
        return res.status(409).json({ error: 'This match has already started or finished.', code: 'MATCH_NOT_JOINABLE' });
      }
      // Re-check the block gate — a block may have landed BETWEEN request and
      // approve (the both-ends gate). Same semantics as instant-join.
      const blocked = await blockedUserIds(targetUserId);
      if (blocked.size > 0) {
        const { data: parts } = await supabase.from('match_participants').select('user_id').eq('match_id', id);
        const others = new Set<string>([
          ...(match.created_by ? [match.created_by as string] : []),
          ...((parts ?? []).map((p) => p.user_id as string)),
        ]);
        if ([...others].some((uid) => blocked.has(uid))) {
          return res.status(403).json({ error: 'This user can’t join — a block exists with a match member.', code: 'BLOCKED_FROM_MATCH' });
        }
      }

      // Capacity + insert + decrement atomically (SC-59). Over-approval is
      // impossible: the RPC returns 'full' once slots run out. The request stays
      // PENDING on a non-success outcome so nothing is silently marked approved.
      const { data: rpc, error: rpcErr } = await supabase.rpc('join_open_match', {
        p_match_id: id,
        p_user_id: targetUserId,
      });
      if (rpcErr) return res.status(500).json({ error: sanitizeError(rpcErr) });
      const row = (Array.isArray(rpc) ? rpc[0] : rpc) as { status: string } | undefined;
      switch (row?.status) {
        case 'joined':
        case 'already_joined':
          break; // proceed to mark approved
        case 'full':
          return res.status(409).json({ error: 'This match is now full.', code: 'MATCH_FULL' });
        case 'not_open':
          return res.status(409).json({ error: 'This match has already started or is closed.', code: 'MATCH_NOT_JOINABLE' });
        case 'not_found':
          return res.status(404).json({ error: 'Match not found' });
        default:
          return res.status(500).json({ error: 'Internal server error' });
      }
    }

    await supabase.from('match_join_requests')
      .update({ status, decided_by: userId, decided_at: new Date().toISOString() })
      .eq('id', reqRow.id);

    // Notify the requester — ungated. (No creator match_joined notif on approval:
    // the creator IS the approver.)
    try {
      const sport = await sportLabel(match.sport_id as string | null);
      void notifyUsers([targetUserId], {
        type: status === 'approved' ? 'match_join_approved' : 'match_join_rejected',
        title: status === 'approved' ? 'Request approved' : 'Request declined',
        body: status === 'approved'
          ? `You’re in — you joined the ${sport}.`
          : `Your request to join the ${sport} was declined.`,
        data: { matchId: id, screen: 'MatchDetail' },
      }, { actorId: userId });
    } catch { /* best-effort */ }

    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// DELETE /matches/:id/join-requests/me — the requester withdraws a pending request.
export async function withdrawMatchJoinRequest(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid match id' });
    const { data: reqRow } = await supabase
      .from('match_join_requests').select('id, status')
      .eq('match_id', id).eq('user_id', userId).maybeSingle();
    if (!reqRow || reqRow.status !== 'pending') {
      return res.status(404).json({ error: 'No pending request to withdraw.' });
    }
    await supabase.from('match_join_requests')
      .update({ status: 'withdrawn', decided_at: new Date().toISOString() })
      .eq('id', reqRow.id);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
