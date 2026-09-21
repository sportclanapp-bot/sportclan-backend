/**
 * SC-430 · one scorer per match.
 *
 * The problem is not corruption. Two phones scoring one match do not damage each
 * other's writes — an advisory lock serialises them and every event carries its
 * own idempotency key. They simply BOTH count, so two scorers tapping every
 * rally produce double the score and nothing says so. Undo does not rescue it
 * either, because undo is scoped to its own author: scorer B cannot undo scorer
 * A's mistake, and A's "last event" may not be the match's last event.
 *
 * THE LEASE IS ADVISORY, CLAIMED OPTIMISTICALLY, ENFORCED AT WRITE. A lease the
 * app cannot evaluate offline is useless at a venue with no signal, and a lease
 * that cannot be overridden is worse than none — phones die mid-match. So the
 * scoring pad never blocks on it; only SENDING does, and the server is the
 * single arbiter.
 *
 * EXPIRY, which is the part that has to survive a real ground:
 *
 *   stale  ≠  released.
 *
 * A heartbeat older than STALE_AFTER_MS makes a lease TAKEABLE. It does not free
 * it and it does not delete the row. Three consequences, all deliberate:
 *   1. a scorer who loses signal keeps their lease, so the queue they built in a
 *      field still drains when they reach coverage — an hour later, a day later;
 *   2. a dead phone cannot block the match forever, because any other eligible
 *      officiant can take a stale lease deliberately, with a reason;
 *   3. nobody is silently ejected. A takeover is a human act, recorded, and the
 *      displaced device finds out as a 409 on its next write — never by its
 *      points quietly failing to appear.
 */

import { supabase } from './supabase';

/** No heartbeat for this long ⇒ the lease may be TAKEN OVER. It is not released,
 *  and the holder can still drain against it until somebody actually takes it. */
export const STALE_AFTER_MS = 5 * 60 * 1000;

export interface ScoringLease {
  match_id: string;
  user_id: string;
  device_id: string;
  claimed_at: string;
  heartbeat_at: string;
  taken_over_from?: string | null;
  taken_over_at?: string | null;
  takeover_reason?: string | null;
}

export const isStale = (lease: Pick<ScoringLease, 'heartbeat_at'>, now = Date.now()): boolean =>
  now - new Date(lease.heartbeat_at).getTime() >= STALE_AFTER_MS;

export async function getLease(matchId: string): Promise<ScoringLease | null> {
  const { data } = await supabase
    .from('match_scoring_leases')
    .select('*')
    .eq('match_id', matchId)
    .maybeSingle();
  return (data as ScoringLease | null) ?? null;
}

export type LeaseVerdict =
  | { ok: true; lease: ScoringLease | null }
  | { ok: false; code: 'LEASE_LOST'; lease: ScoringLease };

/**
 * May this (user, device) write to this match?
 *
 * Deliberately permissive in one direction: **no lease at all means yes**. Leases
 * are claimed by the scoring screen, and refusing every write until one exists
 * would break every path that predates this — a tournament organiser correcting
 * an event, a replayed queue from before the feature shipped — for no safety gain.
 * The lease exists to stop a SECOND scorer, not to gate the first.
 *
 * `deviceId` is optional so a caller that genuinely has no device context (an
 * organiser editing from the match page) is judged on identity alone rather than
 * being locked out by a field it never had.
 */
export async function checkLease(
  matchId: string,
  userId: string,
  deviceId?: string | null,
): Promise<LeaseVerdict> {
  const lease = await getLease(matchId);
  if (!lease) return { ok: true, lease: null };
  if (lease.user_id !== userId) return { ok: false, code: 'LEASE_LOST', lease };
  // Same person, different handset. This IS the case the lease exists for: a
  // scorer who opened the pad on a second phone would otherwise double-score
  // their own match and nothing would say so.
  if (deviceId && lease.device_id !== deviceId) return { ok: false, code: 'LEASE_LOST', lease };
  return { ok: true, lease };
}

/**
 * Claim, or refresh a claim you already hold.
 *
 * Returns `taken: false` when somebody else holds a lease that is NOT yet stale —
 * claiming is never a takeover. Taking a stale lease still goes through
 * `takeOverLease`, so every displacement has a reason attached.
 */
export async function claimLease(
  matchId: string,
  userId: string,
  deviceId: string,
): Promise<{ taken: boolean; lease: ScoringLease | null; heldBy?: ScoringLease }> {
  const existing = await getLease(matchId);
  const nowIso = new Date().toISOString();

  if (existing && (existing.user_id !== userId || existing.device_id !== deviceId)) {
    return { taken: false, lease: null, heldBy: existing };
  }

  const { data, error } = await supabase
    .from('match_scoring_leases')
    .upsert(
      {
        match_id: matchId,
        user_id: userId,
        device_id: deviceId,
        claimed_at: existing ? existing.claimed_at : nowIso,
        heartbeat_at: nowIso,
      },
      { onConflict: 'match_id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return { taken: true, lease: data as ScoringLease };
}

/** Keep a held lease warm. A heartbeat NEVER takes a lease — if you no longer
 *  hold it, you are told so rather than quietly reinstated. */
export async function heartbeatLease(
  matchId: string,
  userId: string,
  deviceId: string,
): Promise<{ ok: boolean; lease: ScoringLease | null }> {
  const { data } = await supabase
    .from('match_scoring_leases')
    .update({ heartbeat_at: new Date().toISOString() })
    .eq('match_id', matchId)
    .eq('user_id', userId)
    .eq('device_id', deviceId)
    .select('*')
    .maybeSingle();
  return { ok: !!data, lease: (data as ScoringLease | null) ?? null };
}

/** Hand the lease back voluntarily — the holder leaving the scoring screen. Only
 *  the holder may release, so a stray call cannot free someone else's lease. */
export async function releaseLease(
  matchId: string,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('match_scoring_leases')
    .delete()
    .eq('match_id', matchId)
    .eq('user_id', userId)
    .eq('device_id', deviceId)
    .select('match_id');
  return (data ?? []).length > 0;
}

/**
 * Take a lease from someone else.
 *
 * Allowed when the current lease is STALE, or when the holder hands over
 * voluntarily (`force`, used by the holder's own "hand over" flow). A reason is
 * required and recorded with who and when, because displacing a scorer mid-match
 * is exactly the kind of act that needs to be explainable afterwards.
 */
export async function takeOverLease(
  matchId: string,
  userId: string,
  deviceId: string,
  reason: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: true; lease: ScoringLease } | { ok: false; code: 'LEASE_ACTIVE'; lease: ScoringLease }> {
  const existing = await getLease(matchId);
  const nowIso = new Date().toISOString();

  if (existing && !opts.force && !isStale(existing)) {
    return { ok: false, code: 'LEASE_ACTIVE', lease: existing };
  }

  const { data, error } = await supabase
    .from('match_scoring_leases')
    .upsert(
      {
        match_id: matchId,
        user_id: userId,
        device_id: deviceId,
        claimed_at: nowIso,
        heartbeat_at: nowIso,
        taken_over_from: existing?.user_id ?? null,
        taken_over_at: existing ? nowIso : null,
        takeover_reason: existing ? reason : null,
      },
      { onConflict: 'match_id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return { ok: true, lease: data as ScoringLease };
}
