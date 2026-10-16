/**
 * The per-user request budgets (SC-431, audit #9, 2.16.0), built in one place so
 * the server and its tests use the same rules.
 *
 *  globalLimiter   every request: 600 per signed-in user (200 per IP when not
 *                  signed in) per 15 minutes — EXCEPT a signed-in scoring write,
 *                  and a refresh with a valid refresh token (refreshLimiter's);
 *  scoringLimiter  signed-in scoring writes only: their own 1200 per user per
 *                  15 minutes (utils/scoringBudget), so browsing can't block a
 *                  point and a script hammering points is still stopped.
 */
import rateLimit, { type Store } from 'express-rate-limit';
import { budgetUserId, clientIpKey, rateLimitKey, refreshUserId } from '../middleware/rateLimitKey';
import { rateLimitBypassed } from '../middleware/rateLimitBypass';
import { isScoringWrite, SCORING_PER_USER_MAX } from './scoringBudget';
import { limitReply } from './limitReply';

export const PER_USER_MAX = 600;
export const PER_IP_MAX = 200;
/** Abuse ceiling for AUTHENTICATED traffic from one address, so per-user keying
 *  cannot be farmed by minting many accounts behind one IP. Generous enough that
 *  a full team on one Wi-Fi never reaches it. */
export const PER_IP_AUTHED_CEILING = 4000;

/**
 * F001 (launch test plan): the per-address ceiling for signed-in users. It had
 * standardHeaders off, so its 429 carried no Retry-After and the default text,
 * and the app waited its own 30 seconds. It now answers like the sign-in
 * limiters (F034): JSON with a code and the wait, plus the Retry-After header.
 */
export function makeIpCeilingLimiter(store: Store, max: number = PER_IP_AUTHED_CEILING) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    keyGenerator: (req) => `ipc:${clientIpKey(req)}`,
    skip: (req) => rateLimitBypassed(req) || !budgetUserId(req),
    standardHeaders: true,
    legacyHeaders: false,
    handler: limitReply('ipc'),
    store,
  });
}

export function makeBudgetLimiters(store: (name: string) => Store) {
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: (req) => (budgetUserId(req) ? PER_USER_MAX : PER_IP_MAX), // audit #9: a refresh is the user's
    keyGenerator: rateLimitKey,
    // Not here: a signed-in scoring write (its own budget, below), and a refresh with a valid refresh token —
    // it has its own (refreshLimiter, 60 per user per 15 minutes). Counted here, a user whose browsing budget
    // was spent couldn't renew the access token, and every point after that was refused (seen in the load run).
    skip: (req) => rateLimitBypassed(req) || (isScoringWrite(req) && !!budgetUserId(req)) || !!refreshUserId(req),
    standardHeaders: true,
    legacyHeaders: false,
    store: store('global'),
  });
  const scoringLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: SCORING_PER_USER_MAX,
    keyGenerator: (req) => `sw:${rateLimitKey(req)}`,
    skip: (req) => rateLimitBypassed(req) || !isScoringWrite(req) || !budgetUserId(req),
    standardHeaders: true,
    legacyHeaders: false,
    store: store('scoring'),
  });
  return { globalLimiter, scoringLimiter };
}
