/**
 * SC-431 · a rate-limit bypass that cannot exist unless someone deliberately
 * creates it.
 *
 * The integration suite makes more requests than any sane limit allows, so it had
 * to be hand-batched across 15-minute windows — which made a full run a 45-minute
 * ritual and, worse, made "run the tests" something people stop doing.
 *
 * The bypass is opt-in at the INFRASTRUCTURE level:
 *
 *   - `RATE_LIMIT_BYPASS_TOKEN` unset (the default, and what production runs) —
 *     this returns false for every request, always. There is no header, no value
 *     and no combination of inputs that can turn it on. The feature is not merely
 *     disabled, it is absent.
 *   - Set, and a request presents the exact value — that request skips the
 *     limiters. Nothing else: authentication, authorisation and every other guard
 *     are untouched, so the bypass can make a test fast but can never make it
 *     pass something it should have failed.
 *
 * The comparison is length-checked then timing-safe, so the token cannot be
 * recovered a byte at a time by measuring responses.
 *
 * A short token is rejected outright. If someone sets it to "test", the bypass
 * stays off rather than quietly protecting production with a guessable string.
 */
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

export const BYPASS_HEADER = 'x-ratelimit-bypass';
/** Anything shorter is treated as unset — a guessable bypass is worse than none. */
const MIN_TOKEN_LENGTH = 24;

export function rateLimitBypassed(req: Request): boolean {
  const expected = process.env.RATE_LIMIT_BYPASS_TOKEN;
  // Absent (production) → the bypass does not exist.
  if (!expected || expected.length < MIN_TOKEN_LENGTH) return false;

  const presented = req.header(BYPASS_HEADER);
  if (!presented) return false;

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, so compare lengths first — that
  // leaks only the length, which the attacker supplied.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
