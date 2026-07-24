/**
 * SC-339 sweep · SportHub leaderboard slug resolution — LIVE integration test.
 *
 * The SportHub "Stats" tab resolved the theme TAB slug → sports UUID with an exact
 * `s.slug === sport` match, so Table Tennis (tab 'tabletennis' vs /sports 'table-tennis')
 * got uuid=null and the leaderboard endpoint was NEVER called → a silently-empty card.
 * The FE fix (sportIdForSlug normalizer, commit cef8d21) makes the resolved UUID reach
 * this endpoint. This test guards the server contract the fix relies on:
 *
 *   - the table-tennis leaderboard returns a NON-EMPTY ranked list (seed exists), so the
 *     fix produces a populated list rather than the old silent-empty;
 *   - a normal-slug sport (cricket) also returns a non-empty list (control);
 *   - the "your rank" card path — getSportProfile by RAW theme slug — still resolves
 *     server-side (this path was already correct; assert it didn't regress);
 *   - a genuinely-empty leaderboard would be a clean empty array (200), NOT an error,
 *     so the FE "No ranked players yet" empty state stays distinct from the null-uuid bug.
 *
 * Read-only: no writes, nothing to clean up.
 */
import https from 'https';

const BASE = process.env.SC_BASE || 'https://sportclan-backend.onrender.com';

function call(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const u = new URL(BASE + path);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve({ status: res.statusCode || 0, data: JSON.parse(b || '{}') }); } catch { resolve({ status: res.statusCode || 0, data: {} }); } }); },
    );
    req.on('error', () => resolve({ status: 0, data: {} }));
    if (payload) req.write(payload);
    req.end();
  });
}
async function login(email: string, password: string): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const { status, data } = await call('POST', '/auth/login', undefined, { email, password });
    if (status === 200 && data.accessToken) return data.accessToken as string;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`login failed for ${email}`);
}

describe('SC-339 SportHub leaderboard resolves the hyphen-mismatched slug', () => {
  let token: string;
  let ttId: string;
  let cricketId: string;

  beforeAll(async () => {
    token = await login('z326agra.qa@sportclan.test', 'SportClanZ326pass');
    const sports = (await call('GET', '/sports', token)).data.sports as any[];
    ttId = sports.find((s) => s.slug === 'table-tennis').id;
    cricketId = sports.find((s) => s.slug === 'cricket').id;
  });

  it('table-tennis leaderboard (the previously-broken sport) returns a non-empty ranked list', async () => {
    const res = await call('GET', `/leaderboard?sport_id=${ttId}&scope=country&limit=25`, token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.leaderboard)).toBe(true);
    expect(res.data.leaderboard.length).toBeGreaterThan(0); // fix → populated, not silent-empty
  });

  it('cricket (normal slug) leaderboard also non-empty — control that the path itself works', async () => {
    const res = await call('GET', `/leaderboard?sport_id=${cricketId}&scope=country&limit=25`, token);
    expect(res.status).toBe(200);
    expect(res.data.leaderboard.length).toBeGreaterThan(0);
  });

  it('"your rank" card: getSportProfile by RAW theme slug (tabletennis) resolves server-side (200, not a slug error)', async () => {
    const me = (await call('GET', '/users/me', token)).data.user.id;
    // The FE passes the raw theme slug here; backend resolveSportId normalizes it.
    const res = await call('GET', `/users/${me}/sport-profile/tabletennis`, token);
    expect(res.status).toBe(200);
    expect(res.data.profile).toBeTruthy();
    // A real per-sport profile came back (rating present) — the raw slug resolved to a
    // sport server-side; an unresolved slug would 400/empty, not a rated profile.
    expect(typeof res.data.profile.rating).toBe('number');
  });

  it('a genuinely-empty leaderboard is a clean empty 200 array, NOT an error (distinct from the null-uuid bug)', async () => {
    // 'city' scope for a fresh account that has scored nothing → the real empty state.
    const empty = await login('z19empty.qa@sportclan.test', 'SportClanZ19pass');
    const res = await call('GET', `/leaderboard?sport_id=${ttId}&scope=city&limit=25`, empty);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.leaderboard)).toBe(true); // FE renders "No ranked players yet", not a broken card
  });
});
