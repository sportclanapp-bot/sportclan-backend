/**
 * SC-433 · the lease rules, once.
 *
 * SC-430 established "one scorer per match" and the offline hub needs exactly the
 * same thing one level up: one hub per tournament. The rules are not merely
 * similar, they are the same rules — the holder is a (person, DEVICE) pair, a
 * quiet heartbeat makes a lease TAKEABLE and never released, a takeover is an
 * explicit human act with a reason, and the displaced holder learns about it as a
 * 409 on its next write rather than by its work quietly vanishing.
 *
 * So this is the implementation, parameterised by table and key column, and both
 * leases are instantiations of it. A second copy would have drifted, and the
 * thing it would drift on is who is allowed to record a tournament's results.
 *
 * WHY stale ≠ released, restated because it is the load-bearing decision:
 *   1. a holder who loses signal KEEPS the lease, so the queue they built in a
 *      field still drains when they reach coverage — an hour later, a day later.
 *      For a hub this is not the edge case, it is the entire working day;
 *   2. a dead phone cannot block the match or the tournament forever, because
 *      anyone else eligible can take a stale lease deliberately, with a reason;
 *   3. nobody is silently ejected.
 */
import { supabase } from './supabase';

/** No heartbeat for this long ⇒ the lease may be TAKEN OVER. It is not released,
 *  and the holder can still work against it until somebody actually takes it. */
export const STALE_AFTER_MS = 5 * 60 * 1000;

export interface LeaseRow {
  user_id: string;
  device_id: string;
  claimed_at: string;
  heartbeat_at: string;
  taken_over_from?: string | null;
  taken_over_at?: string | null;
  takeover_reason?: string | null;
}

export const isStale = (lease: Pick<LeaseRow, 'heartbeat_at'>, now = Date.now()): boolean =>
  now - new Date(lease.heartbeat_at).getTime() >= STALE_AFTER_MS;

export type LeaseVerdict<T> =
  | { ok: true; lease: T | null }
  | { ok: false; code: 'LEASE_LOST' | 'DEVICE_REQUIRED'; lease: T };

/**
 * May this (user, device) write, given the lease row? Pure, so the rule is
 * tested as it runs.
 *
 * - no lease at all → yes: a lease stops a SECOND writer, it does not gate the first;
 * - another person → LEASE_LOST;
 * - the same person on another device → LEASE_LOST;
 * - NO device id while a lease exists → DEVICE_REQUIRED. This used to pass on
 *   identity alone, which made the raw API a backdoor: the holder's own login,
 *   minus the header, could write around the phone holding the pad (found in
 *   user-flow test 4). Every current app request carries the id; an older build
 *   that doesn't gets a 409 saying why, and its outbox holds the points.
 */
export function leaseVerdict<T extends Pick<LeaseRow, 'user_id' | 'device_id'>>(
  lease: T | null,
  userId: string,
  deviceId?: string | null,
): LeaseVerdict<T> {
  if (!lease) return { ok: true, lease: null };
  if (lease.user_id !== userId) return { ok: false, code: 'LEASE_LOST', lease };
  if (!deviceId) return { ok: false, code: 'DEVICE_REQUIRED', lease };
  if (lease.device_id !== deviceId) return { ok: false, code: 'LEASE_LOST', lease };
  return { ok: true, lease };
}

/** The 409 body for a refused verdict — one wording for every write path. */
export function leaseRefusal(verdict: { code: 'LEASE_LOST' | 'DEVICE_REQUIRED' }): { error: string; code: string } {
  return verdict.code === 'DEVICE_REQUIRED'
    ? {
      error: 'This match is being scored on a phone, and this request did not say which device it came from. Update SportClan and score from the app, or take over scoring there.',
      code: 'DEVICE_REQUIRED',
    }
    : { error: 'Someone else took over scoring this match.', code: 'LEASE_LOST' };
}

export function makeLease<T extends LeaseRow>(table: string, idColumn: string) {
  async function get(id: string): Promise<T | null> {
    const { data } = await supabase.from(table).select('*').eq(idColumn, id).maybeSingle();
    return (data as T | null) ?? null;
  }

  /**
   * May this (user, device) write?
   *
   * Deliberately permissive in one direction: **no lease at all means yes**.
   * Refusing every write until one exists would break every path that predates
   * the lease for no safety gain. A lease exists to stop a SECOND holder, not to
   * gate the first.
   */
  async function check(id: string, userId: string, deviceId?: string | null): Promise<LeaseVerdict<T>> {
    return leaseVerdict(await get(id), userId, deviceId);
  }

  /** Claim, or refresh a claim you already hold. Claiming is NEVER a takeover:
   *  somebody else's lease, stale or not, goes through `takeOver` so every
   *  displacement carries a reason. */
  async function claim(id: string, userId: string, deviceId: string):
    Promise<{ taken: boolean; lease: T | null; heldBy?: T }> {
    const existing = await get(id);
    const nowIso = new Date().toISOString();
    if (existing && (existing.user_id !== userId || existing.device_id !== deviceId)) {
      return { taken: false, lease: null, heldBy: existing };
    }
    const { data, error } = await supabase
      .from(table)
      .upsert({
        [idColumn]: id,
        user_id: userId,
        device_id: deviceId,
        claimed_at: existing ? existing.claimed_at : nowIso,
        heartbeat_at: nowIso,
      }, { onConflict: idColumn })
      .select('*')
      .single();
    if (error) throw error;
    return { taken: true, lease: data as T };
  }

  /** Keep a held lease warm. A heartbeat NEVER takes a lease — if you no longer
   *  hold it, you are told so rather than quietly reinstated. */
  async function heartbeat(id: string, userId: string, deviceId: string): Promise<{ ok: boolean; lease: T | null }> {
    const { data } = await supabase
      .from(table)
      .update({ heartbeat_at: new Date().toISOString() })
      .eq(idColumn, id).eq('user_id', userId).eq('device_id', deviceId)
      .select('*').maybeSingle();
    return { ok: !!data, lease: (data as T | null) ?? null };
  }

  /** Hand it back voluntarily. Only the holder may release, so a stray call
   *  cannot free someone else's lease. */
  async function release(id: string, userId: string, deviceId: string): Promise<boolean> {
    const { data } = await supabase
      .from(table).delete()
      .eq(idColumn, id).eq('user_id', userId).eq('device_id', deviceId)
      .select(idColumn);
    return (data ?? []).length > 0;
  }

  /** Take it from someone else. Allowed when the current lease is STALE, or when
   *  the holder hands over voluntarily (`force`). A reason is required and
   *  recorded, because displacing someone mid-event must be explainable after. */
  async function takeOver(
    id: string, userId: string, deviceId: string, reason: string, opts: { force?: boolean } = {},
  ): Promise<{ ok: true; lease: T } | { ok: false; code: 'LEASE_ACTIVE'; lease: T }> {
    const existing = await get(id);
    const nowIso = new Date().toISOString();
    if (existing && !opts.force && !isStale(existing)) {
      return { ok: false, code: 'LEASE_ACTIVE', lease: existing };
    }
    const { data, error } = await supabase
      .from(table)
      .upsert({
        [idColumn]: id,
        user_id: userId,
        device_id: deviceId,
        claimed_at: nowIso,
        heartbeat_at: nowIso,
        taken_over_from: existing?.user_id ?? null,
        taken_over_at: existing ? nowIso : null,
        takeover_reason: existing ? reason : null,
      }, { onConflict: idColumn })
      .select('*').single();
    if (error) throw error;
    return { ok: true, lease: data as T };
  }

  return { get, check, claim, heartbeat, release, takeOver };
}
