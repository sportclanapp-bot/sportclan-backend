/**
 * SC-433 · one offline hub per tournament.
 *
 * The same lease as SC-430's, one level up, and deliberately the same code — see
 * `leaseCore`. What differs is only what the staleness window MEANS here: a
 * scoring lease goes quiet when a phone dies, but a hub goes quiet because it is
 * standing in a field with no signal, which is the entire point of it. So "stale"
 * must never read as "abandoned"; it means another organiser MAY take over
 * deliberately, and the displaced hub keeps every result it collected and learns
 * about the change at sync.
 */
import { makeLease, isStale, STALE_AFTER_MS, type LeaseRow } from './leaseCore';

export { isStale, STALE_AFTER_MS };

export interface HubLease extends LeaseRow {
  tournament_id: string;
}

const lease = makeLease<HubLease>('tournament_hub_leases', 'tournament_id');

export const getHubLease = (tournamentId: string) => lease.get(tournamentId);
export const checkHubLease = (tournamentId: string, userId: string, deviceId?: string | null) =>
  lease.check(tournamentId, userId, deviceId);
export const claimHubLease = (tournamentId: string, userId: string, deviceId: string) =>
  lease.claim(tournamentId, userId, deviceId);
export const heartbeatHubLease = (tournamentId: string, userId: string, deviceId: string) =>
  lease.heartbeat(tournamentId, userId, deviceId);
export const releaseHubLease = (tournamentId: string, userId: string, deviceId: string) =>
  lease.release(tournamentId, userId, deviceId);
export const takeOverHubLease = (
  tournamentId: string, userId: string, deviceId: string, reason: string, opts: { force?: boolean } = {},
) => lease.takeOver(tournamentId, userId, deviceId, reason, opts);
