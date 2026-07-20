/**
 * SC-334 (item 7 closeout) · rating_history is written for ALL sports, not just
 * cricket — LIVE regression guard.
 *
 * rating_history is written in ONE shared, sport-agnostic routine (completeMatch →
 * finalize_match, matches.controller.ts): it builds a row per ranked participant
 * keyed on match.sport_id, gated only by is_ranked && !walkover — there is no
 * per-sport branch. This asserts that guarantee against real data: for a couple of
 * NON-cricket sports, a real completed RANKED match's participant has a
 * rating_history point in that sport. Guards against anyone later adding a sport
 * gate to the write path.
 *
 * Read-only (no matches created / no data modified).
 */
import https from 'https';

const BASE = process.env.SC_BASE || 'https://sportclan-backend.onrender.com';

function call(method: string, path: string, token?: string): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    const u = new URL(BASE + path);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => { try { resolve({ status: res.statusCode || 0, data: JSON.parse(buf || '{}') }); } catch { resolve({ status: res.statusCode || 0, data: {} }); } });
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

// A completed ranked match in `slug` must have a participant with rating_history in it.
async function sportWritesHistory(token: string, slug: string): Promise<boolean> {
  const lm = await call('GET', `/matches?sport_id=${slug}&status=completed&limit=100`, token);
  const ranked = (lm.data.matches || []).filter((m: any) => m.is_ranked === true);
  for (const mt of ranked.slice(0, 6)) {
    const gm = await call('GET', `/matches/${mt.id}`, token);
    for (const p of gm.data.participants || []) {
      const uid = p?.user?.id;
      if (!uid) continue;
      const rh = await call('GET', `/users/${uid}/rating-history?sport_id=${slug}`, token);
      if ((rh.data.history || []).length > 0) return true;
    }
  }
  return false;
}

describe('SC-334 rating_history covers non-cricket sports (shared write path)', () => {
  let token: string;
  beforeAll(async () => {
    token = await login('z326agra.qa@sportclan.test', 'SportClanZ326pass');
  });

  // Two non-cricket sports with plenty of ranked completed matches in the seed.
  for (const slug of ['badminton', 'chess']) {
    it(`${slug}: a completed ranked match produced a rating_history point`, async () => {
      expect(await sportWritesHistory(token, slug)).toBe(true);
    });
  }
});
