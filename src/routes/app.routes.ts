import { Router, Request, Response } from 'express';
import { clientVersionOf, compareVersions } from '../utils/clientVersion';

const router = Router();

/** The Play listing, for when it's live (APP_STORE_LIVE=true and APP_STORE_URL unset). */
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.sportclan.app';

/**
 * F025 (launch test plan): the first app that reads `storeLive`. 2.13.0 and
 * before open `storeUrl || <their own Play link>`, so a null storeUrl sent their
 * testers to a Play page that doesn't exist yet.
 */
export const FIRST_APP_WITH_STORE_LIVE = '2.14.0';

/** F025: where an old app's Update goes while there is no store page and no download link. */
export const GET_UPDATE_PATH = '/app/get-update';

/** Before the listing is live, what the app (2.14.0+) and the get-update page say. */
export const TEAM_UPDATE_TEXT = 'Get the new version from the SportClan team';

/**
 * Release prep (Oct 2026): "no store page yet". `storeLive` is true only when
 * APP_STORE_LIVE=true. `storeUrl` is APP_STORE_URL when set (a download link
 * before the listing exists); blank or "none" is null — never the Play link
 * unless the listing is live. Newer apps read `storeLive` (missing = not
 * live); older apps (2.13.0 and before) open `storeUrl` or their own Play link,
 * so F025: when that would be null, an older app is given this server's own
 * get-update page instead (`opts.clientVersion` older than 2.14.0, `opts.baseUrl`
 * this server). Newer apps' answer is unchanged.
 */
export function appVersionBody(env: NodeJS.ProcessEnv = process.env, opts: { clientVersion?: string | null; baseUrl?: string } = {}) {
  const raw = (env.APP_STORE_URL ?? '').trim();
  const storeLive = env.APP_STORE_LIVE === 'true';
  const own = raw && raw.toLowerCase() !== 'none' ? raw : null;
  let storeUrl = own ?? (storeLive ? PLAY_STORE_URL : null);
  const olderApp = !!opts.clientVersion && compareVersions(opts.clientVersion, FIRST_APP_WITH_STORE_LIVE) < 0;
  if (storeUrl === null && olderApp && opts.baseUrl) storeUrl = `${opts.baseUrl}${GET_UPDATE_PATH}`;
  return {
    latestVersion: env.APP_LATEST_VERSION || '1.0.0',
    minVersion: env.APP_MIN_VERSION || '1.0.0',
    forceUpdate: env.APP_FORCE_UPDATE === 'true',
    storeUrl,
    storeLive,
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** F025: the page an older app's Update opens before the listing exists. */
export function getUpdateHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Update SportClan</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0A1628; color: #fff; line-height: 1.6; margin: 0; padding: 48px 20px; text-align: center; }
  h1 { font-size: 24px; margin: 0 0 12px; }
  p { font-size: 16px; opacity: 0.85; max-width: 480px; margin: 0 auto 12px; }
</style>
</head>
<body>
  <h1>${esc(TEAM_UPDATE_TEXT)}</h1>
  <p>SportClan isn't on the Play Store yet, so the new version comes from the SportClan team. Ask them for it and install it over this one.</p>
  <p>Your account, teams and matches stay as they are.</p>
</body>
</html>`;
}

// GET /app/version — version gate for the mobile client.
// Configure via env so we can bump without redeploying:
//   APP_LATEST_VERSION, APP_MIN_VERSION, APP_FORCE_UPDATE, APP_STORE_URL, APP_STORE_LIVE
router.get('/version', (req: Request, res: Response) => {
  // F025: the answer depends on the app's version, so a cache must keep them apart.
  res.vary('X-Client-Version');
  res.json(appVersionBody(process.env, { clientVersion: clientVersionOf(req), baseUrl: `${req.protocol}://${req.get('host')}` }));
});

// GET /app/get-update — F025: what an older app's Update opens while there is no store page.
router.get('/get-update', (_req: Request, res: Response) => {
  const v = appVersionBody(process.env);
  // A download link or the live listing, once there is one.
  if (v.storeUrl) return res.redirect(302, v.storeUrl);
  res.type('html').send(getUpdateHtml());
});

export default router;
