/**
 * SC-334 · Profile graphs return REAL per-point / per-day values — LIVE test.
 *
 * The rating sparkline + activity heatmap must convey actual numbers, so the
 * endpoints must supply them:
 *   - rating-history: ≤10 points, oldest→newest, delta == new_rating - old_rating;
 *   - activity-heatmap: 84 dense days, each with per-day `matches` + `wins` counts
 *     (wins ≤ matches) and a `type` derived from the counts.
 * Plus the edges the FE must not choke on: EMPTY (new user) + SINGLE point.
 *
 * Read-only (no writes). Fixtures: Aarav Ali (well-connected), z16recap.qa (exactly
 * one cricket match → single point), z19empty.qa (zero matches → empty).
 */
import https from 'https';

const BASE = process.env.SC_BASE || 'https://sportclan-backend.onrender.com';
const AARAV = '5a9eaac3-dea0-4419-906c-911c5af9f38b';

function call(method: string, path: string, token?: string): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    const u = new URL(BASE + path);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(buf || '{}') });
          } catch {
            resolve({ status: res.statusCode || 0, data: {} });
          }
        });
      },
    );
    req.on('error', () => resolve({ status: 0, data: {} }));
    req.end();
  });
}

async function login(email: string, password: string): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const u = new URL(BASE + '/auth/login');
    const body = JSON.stringify({ email, password });
    const res = await new Promise<{ status: number; data: any }>((resolve) => {
      const req = https.request(
        { hostname: u.hostname, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { try { resolve({ status: r.statusCode || 0, data: JSON.parse(b || '{}') }); } catch { resolve({ status: r.statusCode || 0, data: {} }); } }); },
      );
      req.on('error', () => resolve({ status: 0, data: {} }));
      req.write(body); req.end();
    });
    if (res.status === 200 && res.data.accessToken) return res.data.accessToken as string;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`login failed for ${email}`);
}

describe('SC-334 profile graphs — real per-point / per-day values', () => {
  let token: string;
  let cricketId: string;
  let z16Id: string;
  let z19Id: string;

  beforeAll(async () => {
    token = await login('z326agra.qa@sportclan.test', 'SportClanZ326pass');
    const sports = (await call('GET', '/sports', token)).data.sports as any[];
    cricketId = sports.find((s) => s.name === 'Cricket').id;
    const z16 = await login('z16recap.qa@sportclan.test', 'SportClanZ16pass');
    z16Id = (await call('GET', '/users/me', z16)).data.user.id;
    const z19 = await login('z19empty.qa@sportclan.test', 'SportClanZ19pass');
    z19Id = (await call('GET', '/users/me', z19)).data.user.id;
  });

  it('rating-history: ≤10 points, oldest→newest, delta == new - old', async () => {
    const { data } = await call('GET', `/users/${AARAV}/rating-history?sport_id=${cricketId}`, token);
    const hist: any[] = data.history || [];
    expect(hist.length).toBeGreaterThan(1);
    expect(hist.length).toBeLessThanOrEqual(10);
    for (let i = 0; i < hist.length; i++) {
      const p = hist[i];
      expect(typeof p.new_rating).toBe('number');
      expect(Math.abs(p.delta - (p.new_rating - p.old_rating))).toBeLessThan(0.01);
      if (i > 0) expect(new Date(p.created_at).getTime()).toBeGreaterThanOrEqual(new Date(hist[i - 1].created_at).getTime());
    }
  });

  it('activity-heatmap: 84 dense days with real matches+wins counts (wins ≤ matches, type derived)', async () => {
    const { data } = await call('GET', `/users/${AARAV}/activity-heatmap`, token);
    const cells: any[] = data.heatmap || [];
    expect(cells.length).toBe(84);
    let activeDays = 0;
    for (const c of cells) {
      expect(typeof c.matches).toBe('number');
      expect(typeof c.wins).toBe('number');
      expect(c.wins).toBeLessThanOrEqual(c.matches);
      // type must agree with the counts the tooltip shows.
      const expectedType = c.matches === 0 ? 'none' : c.wins > 0 ? 'won' : 'played';
      expect(c.type).toBe(expectedType);
      if (c.matches > 0) activeDays += 1;
    }
    expect(activeDays).toBeGreaterThan(0); // Aarav has recent activity
  });

  it('SINGLE point: z16recap has exactly one cricket rating change', async () => {
    const { data } = await call('GET', `/users/${z16Id}/rating-history?sport_id=${cricketId}`, token);
    const hist: any[] = data.history || [];
    expect(hist.length).toBe(1);
    expect(typeof hist[0].new_rating).toBe('number');
  });

  it('EMPTY: z19empty has no rating history and a zero-activity heatmap', async () => {
    const rh = await call('GET', `/users/${z19Id}/rating-history?sport_id=${cricketId}`, token);
    expect((rh.data.history || []).length).toBe(0);
    const hm = await call('GET', `/users/${z19Id}/activity-heatmap`, token);
    const cells: any[] = hm.data.heatmap || [];
    expect(cells.length).toBe(84);
    expect(cells.every((c) => c.matches === 0 && c.wins === 0 && c.type === 'none')).toBe(true);
  });
});
