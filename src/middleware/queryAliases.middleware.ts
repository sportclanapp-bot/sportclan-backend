/**
 * SC-403 · accept snake_case and camelCase query params interchangeably.
 *
 * The bug this closes is a SILENT WRONG ANSWER, not an error. This API mixes
 * conventions — `/users?userId=…` and `/messages?matchId=…` are camelCase, while
 * `/tournaments?sport_id=…` and `/matches?sport_id=…` are snake_case. Express
 * ignores query params a controller never reads, so calling
 *
 *     GET /tournaments?sportId=<cricket>
 *
 * returned **all 899 tournaments with HTTP 200** instead of the 182 cricket ones.
 * Nothing signalled that the filter had been dropped: the caller gets a
 * plausible, well-formed, completely unfiltered list and has no way to tell.
 * This caught me while reconciling the Sport Hub counters, which is exactly how
 * it would catch anyone writing a client.
 *
 * Rejecting the wrong spelling with a 400 was the other option. Accepting both
 * is better: it cannot break an existing caller, it needs no per-route alias
 * table (the conventions genuinely differ per route, so any central table would
 * drift), and it makes the guessable spelling correct rather than fatal.
 *
 * Only fills in a twin that is ABSENT — an explicitly supplied value always
 * wins, so a caller passing both `sport_id` and `sportId` keeps the canonical
 * one the controller reads.
 */
import type { Request, Response, NextFunction } from 'express';

/** user_id -> userId */
function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** userId -> user_id */
function toSnake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export function queryAliases(req: Request, _res: Response, next: NextFunction) {
  const original = req.query as Record<string, unknown>;
  if (!original || typeof original !== 'object') return next();

  const merged: Record<string, unknown> = { ...original };
  let added = false;

  for (const key of Object.keys(original)) {
    for (const twin of [toCamel(key), toSnake(key)]) {
      if (twin !== key && !(twin in merged)) {
        merged[twin] = original[key];
        added = true;
      }
    }
  }

  if (added) {
    // Express 5 exposes req.query through a memoising getter, so it cannot be
    // assigned to directly — redefine the property on this request only.
    Object.defineProperty(req, 'query', {
      value: merged,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  }
  return next();
}
