/**
 * Rate headroom (2.16.0, 11 Oct 2026) · scoring writes have their own budget.
 *
 * Every signed-in request shared one budget of 600 per user per 15 minutes. A
 * real tournament day stays well under it (organiser ~150, a scorer of three
 * fast matches ~220, measured), but a person who browses fast while scoring
 * could spend it on reads — and then the POINTS were refused, the one thing that
 * must never wait. Scoring writes (a point, an undo, the scoring lease, a typed
 * score, an event edit) now count in a bucket of their own, so browsing can't
 * block scoring and scoring can't crowd out browsing.
 *
 * Anti-abuse stays: the scoring bucket is itself limited (SCORING_PER_USER_MAX,
 * twice the fastest real scoring — a point every 1.5 s for 15 minutes), the
 * per-IP ceiling still counts every request, and anything unauthenticated
 * keeps the per-IP budget.
 */
import type { Request } from 'express';

export const SCORING_PER_USER_MAX = 1200;

const SCORING_WRITE_PATHS = [
  /^\/scoring\/[^/]+\/(event|undo)\/?$/,
  /^\/matches\/[^/]+\/scoring-lease(\/(heartbeat|release|handover|takeover))?\/?$/,
  /^\/matches\/[^/]+\/(typed-score|edit-event)\/?$/,
];

/** A write that scores a match (POST to one of the scoring paths). */
export function isScoringWrite(req: Pick<Request, 'method' | 'path'>): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return false;
  const p = (req.path || '').split('?')[0];
  return SCORING_WRITE_PATHS.some((rx) => rx.test(p));
}
