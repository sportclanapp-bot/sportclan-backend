/**
 * SC-397 · reject malformed id path params before they reach the database.
 *
 * A non-UUID in an id position (`/users/not-an-id/followers`) was passed
 * straight into the query, Postgres rejected the cast, and the request
 * surfaced as a **500**. Fourteen GET endpoints did this — found by probing
 * every parameterised route with a garbage id.
 *
 * A crash is not a guard: a 500 tells the client nothing actionable, pollutes
 * error monitoring, and hides real faults among the noise. A malformed id is a
 * caller mistake and belongs in the 4xx range.
 *
 * Registered with `router.param()`, so it fires for ANY route on that router
 * carrying the named param — including ones added later, which is the point:
 * this closes the class, not the fourteen instances.
 */
import { Request, Response, NextFunction } from 'express';
import { isUuid } from '../utils/uuid';

/** The param names used for ids across the API. */
export const ID_PARAMS = [
  'id', 'userId', 'matchId', 'teamId', 'sessionId', 'memberId',
  'messageId', 'sportId', 'entryId', 'targetUserId',
] as const;

function validate(req: Request, res: Response, next: NextFunction, value: string) {
  if (!isUuid(value)) {
    return res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' });
  }
  return next();
}

/** Attach id-shape validation for every known id param to a router. */
export function guardIdParams(router: { param: (name: string, fn: typeof validate) => unknown }) {
  for (const name of ID_PARAMS) router.param(name, validate);
}
