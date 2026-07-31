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
  // Strictly-before, so a token minted in the same second as the revocation —
  // the replacement handed to the device doing the revoking — still works.
  return issuedAtSeconds * 1000 < entry.revokedAtMs;
}

/**
 * Mark every token issued up to now as revoked for this user.
 *
 * The cutoff is TRUNCATED TO THE SECOND on purpose. A JWT's `iat` is whole
 * seconds, so storing millisecond precision meant the replacement token minted
 * immediately after the stamp compared as OLDER than it — revoked at 12:00:00.750
 * but issued with iat 12:00:00, i.e. 750ms "before" its own cause. That signed
 * the revoking device out of itself, which is the one thing this must not do.
 * Flooring makes both sides second-precision, so a token minted in the same
 * second survives and anything from an earlier second does not. The residual is
 * that a token issued up to a second before the revocation also survives — a
 * sub-second window, against the 900 seconds this exists to close.
 */
export async function revokeSessionsNow(userId: string): Promise<string> {
  const nowIso = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
  await supabase.from('users').update({ sessions_revoked_at: nowIso }).eq('id', userId);
  invalidateRevocationCache(userId);
  return nowIso;
}
