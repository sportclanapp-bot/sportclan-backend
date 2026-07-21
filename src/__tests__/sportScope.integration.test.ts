/**
 * SC-335 · Kabaddi + Athletics are out of scope — LIVE guards. Passes once
 * migration 070 (sports.is_active, kabaddi/athletics=false) is applied; before that
 * the BE deploy is a safe no-op (is_active absent → everything treated active).
 *
 * Asserts:
 *   1. GET /sports returns exactly the canonical 11 — no kabaddi/athletics slug.
 *   2. creating a match in an inactive sport is rejected (400).
 *   3. per-sport reads (sport-profile / rating-history / leaderboard) for an
 *      inactive sport 404 — a profile can't expose a Kabaddi/Athletics tab or stat.
 *
 * Read-only except the create attempt, which is REJECTED (no row inserted).
 */
import https from 'https';

const BASE = process.env.SC_BASE || 'https://sportclan-backend.onrender.com';
// Resolved from prod before the deactivation (kept as constants so the ids survive
// once /sports stops returning them).
const KABADDI = 'd55be36f-6d36-4f74-9e1f-74e7671c7389';
const ATHLETICS = '39801a2c-966a-4025-b035-04ac7da013b5';
const CANONICAL_11 = [
  'cricket', 'badminton', 'football', 'tennis', 'table-tennis', 'pickleball',
  'chess', 'carrom', 'volleyball', 'basketball', 'hockey',
];

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

describe('SC-335 out-of-scope sports (kabaddi/athletics)', () => {
  let token: string;
  beforeAll(async () => {
    token = await login('z326agra.qa@sportclan.test', 'SportClanZ326pass');
  });

  it('GET /sports returns exactly the canonical 11 — no kabaddi/athletics', async () => {
    const { data } = await call('GET', '/sports', token);
    const slugs = (data.sports || []).map((s: any) => s.slug);
    expect(slugs).not.toContain('kabaddi');
    expect(slugs).not.toContain('athletics');
    expect(slugs.slice().sort()).toEqual(CANONICAL_11.slice().sort());
    expect(slugs.length).toBe(11);
  });

  it('creating a match in an inactive sport is rejected (400)', async () => {
    for (const sportId of [KABADDI, ATHLETICS]) {
      const res = await call('POST', '/matches', token, {
        sport_id: sportId, team_a_name: 'A', team_b_name: 'B', is_ranked: false,
      });
      expect(res.status).toBe(400);
    }
  });

  it('per-sport reads for an inactive sport 404 (no Kabaddi/Athletics tab or stat)', async () => {
    const meId = (await call('GET', '/users/me', token)).data.user.id;
    for (const sportId of [KABADDI, ATHLETICS]) {
      const prof = await call('GET', `/users/${meId}/sport-profile/${sportId}`, token);
      expect(prof.status).toBe(404);
      const hist = await call('GET', `/users/${meId}/rating-history?sport_id=${sportId}`, token);
      expect(hist.status).toBe(404);
      const lb = await call('GET', `/leaderboard?sport_id=${sportId}&scope=global&limit=10`, token);
      expect(lb.status).toBe(404);
    }
  });
});
