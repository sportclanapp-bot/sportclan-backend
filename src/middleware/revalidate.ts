import type { NextFunction, Request, Response } from 'express';

/**
 * N-R7-63 (Step 2) · every API answer says "ask me again before you reuse this". With an ETag
 * and no Cache-Control, Android's HTTP cache judged freshness from the phone clock — a clock a
 * minute behind made a saved list look fresh, and it was answered from disk with no network.
 * `no-cache` still allows the cheap 304 revalidation; `private` keeps it out of shared caches.
 * Mounted before every route so the near-static ones (cities, sports, app) set their own max-age.
 */
export function revalidateAlways(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'private, no-cache');
  next();
}
