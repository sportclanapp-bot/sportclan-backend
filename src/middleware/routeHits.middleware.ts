/**
 * SC-396 item 2 · TEMPORARY route-hit recorder.
 *
 * Static matching of FE call sites to BE routes has already nearly caused a bad
 * deletion: a literal matcher reported 96 endpoints "unused", including
 * /tournaments/:id/bracket and /users/:id/followers, both of which are called
 * constantly. It cannot resolve URLs the client builds at runtime.
 *
 * So: record what is ACTUALLY hit. `req.route.path` gives the registered
 * pattern (`/users/:id/followers`), not the concrete URL, so this is a set of
 * route identities rather than a log of user activity — no ids, no query
 * strings, no bodies, nothing user-identifying is stored.
 *
 * REMOVE THIS ONCE THE SWEEP IS DONE. It is registered in index.ts and exposed
 * via GET /internal/route-hits behind the same cron secret as /internal/jobs.
 */
import { Request, Response, NextFunction } from 'express';

const hits = new Map<string, number>();

export function recordRouteHit(req: Request, res: Response, next: NextFunction) {
  res.on('finish', () => {
    // baseUrl is the mount prefix ('/users'); route.path is the pattern.
    const pattern = (req as unknown as { route?: { path?: string } }).route?.path;
    if (!pattern) return; // unmatched 404s carry no route identity
    const key = `${req.method} ${(req.baseUrl || '') + pattern}`.replace(/\/+$/, '') || `${req.method} /`;
    hits.set(key, (hits.get(key) ?? 0) + 1);
  });
  next();
}

export function getRouteHits(): Array<{ route: string; count: number }> {
  return Array.from(hits.entries())
    .map(([route, count]) => ({ route, count }))
    .sort((a, b) => b.count - a.count);
}
