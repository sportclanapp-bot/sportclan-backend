/**
 * Audit #7 (11 Oct 2026): profiles (with date of birth), followers, following,
 * reviews, wall posts and community posts (with a match scorecard) answered
 * without a token — a way to see a score outside the app. Every route now
 * needs sign-in except the pre-sign-in flows, static reference data and the
 * secret-guarded job endpoints listed here.
 */
import fs from 'fs';
import path from 'path';

const ROUTES = path.join(__dirname, '..', 'routes');
// file → routes that may answer without a token (method path).
const ALLOWED: Record<string, string[]> = {
  'auth.routes.ts': ['*'], // sign-in, sign-up, refresh, reset — pre-auth by nature
  'app.routes.ts': ['GET /version', 'GET /get-update'], // F025: a static page an old app's Update opens in the browser
  'cities.routes.ts': ['*'],
  'sports.routes.ts': ['*'],
  'gifts.routes.ts': ['GET /catalogue'],
  'jobs.routes.ts': ['*'], // X-Cron-Secret (router-level)
  'account.routes.ts': ['POST /purge-expired'], // X-Cron-Secret (in the handler)
  'seasons.routes.ts': ['POST /end'], // admin secret (in the handler)
};

describe('audit #7: every data route needs sign-in', () => {
  const files = fs.readdirSync(ROUTES).filter((f) => f.endsWith('.routes.ts'));
  for (const f of files) {
    it(`${f}`, () => {
      const src = fs.readFileSync(path.join(ROUTES, f), 'utf8');
      const routerWide = /router\.use\(\s*(authenticateToken|requireAdmin|authenticate)/.test(src);
      const open: string[] = [];
      for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'\s*,([^\n]*)/g)) {
        const [, method, p, rest] = m;
        if (routerWide || /authenticateToken|requireAdmin|cronAuth|requireCron/.test(rest)) continue;
        const key = `${method.toUpperCase()} ${p}`;
        const allow = ALLOWED[f] ?? [];
        if (allow.includes('*') || allow.includes(key)) continue;
        open.push(key);
      }
      expect(open).toEqual([]);
    });
  }
  it('optionalAuth is no longer used on any route', () => {
    for (const f of files) expect(fs.readFileSync(path.join(ROUTES, f), 'utf8')).not.toMatch(/router\.\w+\([^\n]*optionalAuth/);
  });
});
