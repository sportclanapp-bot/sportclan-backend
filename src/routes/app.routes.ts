import { Router, Request, Response } from 'express';

const router = Router();

/** The Play listing, for when it's live (APP_STORE_LIVE=true and APP_STORE_URL unset). */
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.sportclan.app';

/**
 * Release prep (Oct 2026): "no store page yet". `storeLive` is true only when
 * APP_STORE_LIVE=true. `storeUrl` is APP_STORE_URL when set (a download link
 * before the listing exists); blank or "none" is null — never the Play link
 * unless the listing is live. Newer apps read `storeLive` (missing = not
 * live); older apps (2.13.0 and before) open `storeUrl` or their own Play link.
 */
export function appVersionBody(env: NodeJS.ProcessEnv = process.env) {
  const raw = (env.APP_STORE_URL ?? '').trim();
  const storeLive = env.APP_STORE_LIVE === 'true';
  const own = raw && raw.toLowerCase() !== 'none' ? raw : null;
  return {
    latestVersion: env.APP_LATEST_VERSION || '1.0.0',
    minVersion: env.APP_MIN_VERSION || '1.0.0',
    forceUpdate: env.APP_FORCE_UPDATE === 'true',
    storeUrl: own ?? (storeLive ? PLAY_STORE_URL : null),
    storeLive,
  };
}

// GET /app/version — version gate for the mobile client.
// Configure via env so we can bump without redeploying:
//   APP_LATEST_VERSION, APP_MIN_VERSION, APP_FORCE_UPDATE, APP_STORE_URL, APP_STORE_LIVE
router.get('/version', (_req: Request, res: Response) => res.json(appVersionBody()));

export default router;
