/**
 * SC-339 · Play-invite pending-state is SPORT-AGNOSTIC — LIVE integration test.
 *
 * The cricket-only invited-state bug was FE (a slug mismatch), but this guards the
 * server contract it relies on: sending an invite in a NON-cricket sport surfaces
 * that sport's id in getUser.pending_invite_sport_ids IDENTICALLY to any other sport,
 * and sports are independent. Includes Table Tennis (the sport whose slug differed).
 *
 * Self-restoring: withdraws every invite it creates (the DELETE endpoint is kept for
 * cleanup even though the UI no longer exposes it). Uses sports disjoint from the
 * SC-331/SC-332 suites (chess / table-tennis / volleyball) so it's parallel-safe.
 *
 * Fixtures: z326agra.qa (sender) · z19empty.qa (receiver).
 */
import https from 'https';

const BASE = process.env.SC_BASE || 'https://sportclan-backend.onrender.com';
const SPORT_NAMES = ['Chess', 'Table Tennis', 'Volleyball'];

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

describe('SC-339 invite pending-state is sport-agnostic', () => {
  let aToken: string;
  let aId: string;
  let bToken: string;
  let bId: string;
  let sportIds: Record<string, string> = {};

  async function pendingSports(): Promise<string[]> {
    return (await call('GET', `/users/${bId}`, aToken)).data.pending_invite_sport_ids || [];
  }
  async function clearMine(): Promise<void> {
    const inbox = (await call('GET', '/invites', bToken)).data.invites || [];
    const mine = new Set(Object.values(sportIds));
    for (const inv of inbox) {
      if (inv.sender_id === aId && inv.status === 'pending' && mine.has(inv.sport_id)) {
        await call('DELETE', `/invites/${inv.id}`, aToken); // kept endpoint (cleanup only)
      }
    }
  }

  beforeAll(async () => {
    aToken = await login('z326agra.qa@sportclan.test', 'SportClanZ326pass');
    aId = (await call('GET', '/users/me', aToken)).data.user.id;
    bToken = await login('z19empty.qa@sportclan.test', 'SportClanZ19pass');
    bId = (await call('GET', '/users/me', bToken)).data.user.id;
    const sports = (await call('GET', '/sports', aToken)).data.sports as any[];
    for (const n of SPORT_NAMES) sportIds[n] = sports.find((s) => s.name === n).id;
    await clearMine();
  });

  afterAll(async () => { await clearMine(); });

  it('each non-cricket sport, invited, appears in pending_invite_sport_ids — and only itself', async () => {
    const invited: string[] = [];
    for (const name of SPORT_NAMES) {
      const sid = sportIds[name]!;
      const res = await call('POST', '/invites', aToken, { receiver_id: bId, sport_id: sid });
      expect(res.status).toBeLessThan(400);
      expect(res.data.invite.sport_id).toBe(sid);
      invited.push(sid);

      const pend = await pendingSports();
      // this sport is now pending...
      expect(pend).toContain(sid);
      // ...and EVERY sport invited so far is still pending (independent, none dropped)
      for (const prev of invited) expect(pend).toContain(prev);
      // ...and a sport NOT yet invited is NOT pending
      const notYet = SPORT_NAMES.map((n) => sportIds[n]!).filter((x) => !invited.includes(x));
      for (const ny of notYet) expect(pend).not.toContain(ny);
    }
    // Table Tennis specifically (the slug-mismatch sport) behaves like the rest.
    expect(await pendingSports()).toContain(sportIds['Table Tennis']);
  });
});
