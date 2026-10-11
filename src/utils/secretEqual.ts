/**
 * Audit #33 (11 Oct 2026): cron and admin secrets were compared with `!==`,
 * which can leak how much of a guess was right through timing. This compares
 * in constant time (both sides hashed first, so even the length isn't leaked).
 * An unset or empty expected secret never matches.
 */
import crypto from 'crypto';

export function secretEquals(presented: unknown, expected: string | undefined | null): boolean {
  if (!expected || typeof presented !== 'string' || presented.length === 0) return false;
  const a = crypto.createHash('sha256').update(presented, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}
