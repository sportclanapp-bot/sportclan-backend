import { Request, Response, NextFunction } from 'express';

/**
 * Gates a route behind the shared cron secret. The `X-Cron-Secret` header must
 * match `process.env.CRON_SECRET`. Fails CLOSED — if CRON_SECRET is unset the
 * endpoint is disabled (403) rather than left open. Use for scheduled-job
 * trigger endpoints so a stray JWT can't fire fan-outs.
 */
export function requireCronSecret(req: Request, res: Response, next: NextFunction) {
  const secret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return next();
}
