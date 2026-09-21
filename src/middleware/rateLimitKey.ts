/**
 * SC-431 · rate-limit the PERSON, not the pipe.
 *
 * The limiter was keyed on IP, which is wrong in two directions at a real venue:
 *
 *  - Indian mobile carriers put many subscribers behind one address via CGNAT,
 *    and everyone at a ground shares one Wi-Fi. So a hundred spectators looked
 *    like one very busy client, and the budget that was meant to stop one abuser
 *    silenced the whole venue.
 *  - Meanwhile one signed-in viewer polling a live match could spend the entire
 *    per-IP budget by themselves in minutes, locking out everybody who happened
 *    to share their exit address.
 *
 * So: an authenticated request is keyed and budgeted per USER. Everything else —
 * login, signup, OTP, anything with no verified identity yet — stays keyed on IP,
 * which is the only handle available there and is exactly where the abuse
 * protection needs to be.
 *
 * THE TOKEN IS VERIFIED, not merely decoded. Keying on an unverified `sub` would
 * hand anyone a fresh bucket for the cost of forging a header, which is a worse
 * hole than the one being fixed. An invalid token simply falls back to IP.
 */
import type { Request } from 'express';
import { verifyAccessToken } from '../utils/jwt';

/** Verified user id for this request, or null when there isn't one. */
export function verifiedUserId(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  try {
    const payload = verifyAccessToken(header.slice(7));
    return payload?.userId ?? null;
  } catch {
    // Expired or forged: not an identity we will grant a private budget to.
    return null;
  }
}

/** Per-request limiter key: the user when we know them, else the address. */
export function rateLimitKey(req: Request): string {
  const userId = verifiedUserId(req);
  if (userId) return `u:${userId}`;
  return `ip:${req.ip ?? 'unknown'}`;
}
