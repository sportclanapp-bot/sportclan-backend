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
/**
 * SC-403: `sportId` was REMOVED from this list.
 *
 * It was a regression I shipped in SC-397. `/users/:id/sport-profile/:sportId`
 * deliberately accepts a slug — the mobile app passes the raw theme slug
 * ('cricket', 'tabletennis') and utils/sportId.resolveSportId maps it to the
 * real UUID server-side. Guarding it as a UUID turned every one of those calls
 * into 400 INVALID_ID in production, which is what broke the Sport Hub
 * "your rank" card. The integration suite caught it.
 *
 * The lesson for anything added here: a param named `<thing>Id` is not
 * automatically a UUID. Only add a param once you have checked that EVERY route
 * binding it rejects non-UUIDs anyway.
 */
export const ID_PARAMS = [
  'id', 'userId', 'matchId', 'teamId', 'sessionId', 'memberId',
  'messageId', 'entryId', 'targetUserId',
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
