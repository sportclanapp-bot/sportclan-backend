// SC-384 · the "have this user's sessions been revoked?" lookup that sits in
// front of every authenticated request.
//
// authenticateToken is deliberately stateless — verify the JWT and move on —
// so adding a synchronous database read per request is a real cost. It is also
// unavoidable if revocation is to mean anything before the token expires: a
// stateless token cannot know it has been revoked.
//
// The compromise is a small in-process cache. A user's revocation timestamp is
// read at most once per TTL window, and revokeSessions() clears the entry in
// the same process immediately, so the device doing the revoking sees it take
// effect at once. The window only ever applies to OTHER server instances that
// have a warm cache entry, and it is seconds rather than the fifteen minutes a
// token would otherwise survive.
import { supabase } from './supabase';

const TTL_MS = 10_000;

type Entry = { revokedAtMs: number | null; fetchedAt: number };
const cache = new Map<string, Entry>();

/** Drop a user's cached value so the next check re-reads it. */
export function invalidateRevocationCache(userId: string): void {
  cache.delete(userId);
}

/**
 * True when `issuedAtSeconds` predates the user's last session revocation, i.e.
 * this token was minted before the user said "sign out my other devices".
 *
 * Fails OPEN on a lookup error: a database blip must not sign the whole user
 * base out. The refresh-token deletion is still in place underneath, so a
 * revoked device cannot renew even if one check slips through.
 */
export async function isTokenRevoked(userId: string, issuedAtSeconds?: number): Promise<boolean> {
  if (!issuedAtSeconds) return false;

  const now = Date.now();
  let entry = cache.get(userId);
  if (!entry || now - entry.fetchedAt > TTL_MS) {
    const { data, error } = await supabase
      .from('users')
      .select('sessions_revoked_at')
      .eq('id', userId)
      .maybeSingle();
    if (error) return false;
    const raw = (data as any)?.sessions_revoked_at ?? null;
    entry = { revokedAtMs: raw ? new Date(raw).getTime() : null, fetchedAt: now };
    cache.set(userId, entry);
  }

  if (entry.revokedAtMs == null) return false;
  // Strictly-before against a full-precision cutoff: every token whose issuing
  // second began before the revocation instant is refused, including one minted
  // in the same second. The caller's replacement escapes this by being stamped
  // with the NEXT whole second (generateAccessTokenAt), not by softening the
  // comparison — softening it is what let same-second sessions survive.
  return issuedAtSeconds * 1000 < entry.revokedAtMs;
}

/**
 * Mark every token issued up to now as revoked for this user.
 *
 * The cutoff keeps FULL millisecond precision. Flooring it to the second (the
 * first attempt at this) closed the sign-myself-out bug but opened a real one:
 * any session established in the same second as the revocation survived it,
 * which a 10-cycle prod run reproduced on the third try. The caller's
 * replacement token is instead stamped with the NEXT whole second by
 * revokeAllSessions, so the ambiguity is resolved in the safe direction —
 * everything from the cutoff second dies, and only the replacement outlives it.
 *
 * Returns the cutoff in milliseconds so the caller can derive that stamp.
 */
export async function revokeSessionsNow(userId: string): Promise<number> {
  const nowMs = Date.now();
  await supabase
    .from('users')
    .update({ sessions_revoked_at: new Date(nowMs).toISOString() })
    .eq('id', userId);
  invalidateRevocationCache(userId);
  return nowMs;
}
