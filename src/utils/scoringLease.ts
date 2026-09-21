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

import { makeLease, isStale, STALE_AFTER_MS, type LeaseRow, type LeaseVerdict } from './leaseCore';

/**
 * SC-433: the rules themselves now live in `leaseCore`, because the offline
 * tournament hub needs the same ones one level up and two copies would have
 * drifted on who may record a tournament's results. Everything this module
 * exported still exports, with the same signatures — this is a re-point, not a
 * change of behaviour.
 */
export { isStale, STALE_AFTER_MS };

export interface ScoringLease extends LeaseRow {
  match_id: string;
}

const lease = makeLease<ScoringLease>('match_scoring_leases', 'match_id');

export type { LeaseVerdict };

export const getLease = (matchId: string) => lease.get(matchId);
export const checkLease = (matchId: string, userId: string, deviceId?: string | null) =>
  lease.check(matchId, userId, deviceId);
export const claimLease = (matchId: string, userId: string, deviceId: string) =>
  lease.claim(matchId, userId, deviceId);
export const heartbeatLease = (matchId: string, userId: string, deviceId: string) =>
  lease.heartbeat(matchId, userId, deviceId);
export const releaseLease = (matchId: string, userId: string, deviceId: string) =>
  lease.release(matchId, userId, deviceId);
export const takeOverLease = (
  matchId: string, userId: string, deviceId: string, reason: string, opts: { force?: boolean } = {},
) => lease.takeOver(matchId, userId, deviceId, reason, opts);
