/**
 * N-R7-63 (Step 2, RW-G3-069) · API answers carried an ETag but no Cache-Control. Android's HTTP
 * cache (OkHttp, under React Native's fetch) then judges freshness from the phone clock: with
 * the clock a minute behind the moment a list was saved, the saved answer looks "fresh" and is
 * served from disk with no network at all — offline, the Sport hub showed old lists as LIVE with
 * no "last saw" line. Every answer now says `private, no-cache`: always ask the server first
 * (an unchanged answer is still a cheap 304), never answer from disk unasked. The few
 * near-static routes keep their own max-age.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { revalidateAlways } from '../middleware/revalidate';

describe('N-R7-63: no answer is served from a phone cache without asking', () => {
  it('sets private, no-cache', () => {
    const headers: Record<string, string> = {};
    const res = { set: (k: string, v: string) => { headers[k] = v; } };
    const next = jest.fn();
    revalidateAlways({} as never, res as never, next);
    expect(headers['Cache-Control']).toBe('private, no-cache');
    expect(next).toHaveBeenCalled();
  });
  it('is mounted before every route, so the near-static ones can still override it', () => {
    const idx = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
    const at = idx.indexOf('app.use(revalidateAlways);');
    expect(at).toBeGreaterThan(-1);
    for (const r of ["app.use('/auth', authLimiter", "app.use('/cities', cacheFor(86400)", "app.use('/matches', matchesRoutes)", "app.use('/teams', teamsRoutes)"]) {
      expect(idx.indexOf(r)).toBeGreaterThan(at);
    }
  });
});
