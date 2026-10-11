/**
 * The per-user request budgets (SC-431, audit #9, 2.16.0), built in one place so
 * the server and its tests use the same rules.
 *
 *  globalLimiter   every request: 600 per signed-in user (200 per IP when not
 *                  signed in) per 15 minutes — EXCEPT a signed-in scoring write;
 *  scoringLimiter  signed-in scoring writes only: their own 1200 per user per
 *                  15 minutes (utils/scoringBudget), so browsing can't block a
 *                  point and a script hammering points is still stopped.
 */
import rateLimit, { type Store } from 'express-rate-limit';
import { budgetUserId, rateLimitKey } from '../middleware/rateLimitKey';
import { rateLimitBypassed } from '../middleware/rateLimitBypass';
import { isScoringWrite, SCORING_PER_USER_MAX } from './scoringBudget';

export const PER_USER_MAX = 600;
export const PER_IP_MAX = 200;

export function makeBudgetLimiters(store: (name: string) => Store) {
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: (req) => (budgetUserId(req) ? PER_USER_MAX : PER_IP_MAX), // audit #9: a refresh is the user's
    keyGenerator: rateLimitKey,
    skip: (req) => rateLimitBypassed(req) || (isScoringWrite(req) && !!budgetUserId(req)),
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
