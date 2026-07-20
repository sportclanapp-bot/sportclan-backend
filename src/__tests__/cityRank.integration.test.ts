/**
 * SC-326 · Per-sport city rank — LIVE integration test (real round-trip).
 *
 * Proves getSportProfile.cityRank is a real, city-scoped, per-sport rank by
 * comparing it to a DIRECT city-leaderboard query: paginate the whole city+sport
 * leaderboard, re-rank it by the spec ordering (rating desc → matches_played desc
 * → user_id asc), and assert the target's position equals the endpoint's cityRank.
 * No stored/seed constant is trusted.
 *
 * Fixtures (QA accounts, pre-provisioned; read-only here):
 *   z326agra.qa  — city = Agra (the "lens" to query Agra's city leaderboard)
 *   Aarav Ali    — a ranked Agra cricketer (the target)
 *   z19empty.qa  — zero-match account (the null-rank case)
 */
import https from 'https';

const BASE = process.env.SC_BASE || 'https://sportclan-backend.onrender.com';
const AARAV = '5a9eaac3-dea0-4419-906c-911c5af9f38b';

function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const u = new URL(BASE + path);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
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

/** Every city+sport player, following the leaderboard's own pagination. */
async function fullCityLeaderboard(token: string, sportId: string): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; offset < 5000; offset += 50) {
    const { data } = await call(
      'GET',
      `/leaderboard?sport_id=${sportId}&scope=city&limit=50&offset=${offset}`,
      token,
    );
    const page: any[] = data.leaderboard || [];
    rows.push(...page);
    if (!data.has_more || page.length === 0) break;
  }
  return rows;
}

describe('SC-326 per-sport city rank', () => {
  let token: string;
  let cricketId: string;

  beforeAll(async () => {
    token = await login('z326agra.qa@sportclan.test', 'SportClanZ326pass');
    const sports = (await call('GET', '/sports', token)).data.sports as any[];
    cricketId = sports.find((s) => s.name === 'Cricket').id;
  });

  it('cityRank equals the target’s position in a direct city+sport leaderboard query', async () => {
    const prof = (await call('GET', `/users/${AARAV}/sport-profile/${cricketId}`, token)).data.profile;
    expect(prof.cityRank).not.toBeNull();

    // DIRECT query: rank every rated Agra cricketer by the spec ordering.
    const rows = await fullCityLeaderboard(token, cricketId);
    const ranked = rows
      .filter((r) => (r.matches_played ?? 0) >= 1)
      .sort(
        (a, b) =>
          Number(b.rating) - Number(a.rating) ||
          (b.matches_played ?? 0) - (a.matches_played ?? 0) ||
          (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0),
      );
    const expected = ranked.findIndex((r) => r.user_id === AARAV) + 1;

    expect(expected).toBeGreaterThan(0); // Aarav is in Agra's cricket leaderboard
    expect(prof.cityRank).toBe(expected); // endpoint == direct query
    // City is a SUBSET of Global → cityRank <= globalRank (equal is valid, e.g. the
    // city's #1 who is also the nation's #1). Was strict <, which could false-fail.
    expect(prof.cityRank).toBeLessThanOrEqual(prof.globalRank);
  });

  it('globalRank equals the target’s position in a direct NATIONAL leaderboard query', async () => {
    // Fetch the national top by the leaderboard's own order, then re-rank by the
    // SPEC ordering. A target well inside the fetched set has all spec-higher players
    // present (they're all higher-rated), so its position == its global rank.
    const rows: any[] = [];
    for (let offset = 0; offset < 300; offset += 50) {
      const { data } = await call('GET', `/leaderboard?sport_id=${cricketId}&scope=global&limit=50&offset=${offset}`, token);
      const page: any[] = data.leaderboard || [];
      rows.push(...page);
      if (!data.has_more || page.length === 0) break;
    }
    const ranked = rows
      .filter((r) => (r.matches_played ?? 0) >= 1)
      .sort(
        (a, b) =>
          Number(b.rating) - Number(a.rating) ||
          (b.matches_played ?? 0) - (a.matches_played ?? 0) ||
          (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0),
      );
    // Pick a target ~position 30 — deep enough that boundary tie-breaks can't shift it.
    const idx = Math.min(29, ranked.length - 1);
    const target = ranked[idx];
    const expectedGlobal = idx + 1;

    const prof = (await call('GET', `/users/${target.user_id}/sport-profile/${cricketId}`, token)).data.profile;
    expect(prof.globalRank).toBe(expectedGlobal); // endpoint == direct national query
  });

  it('cityRank AND globalRank are null for a user with no rated match (never a fake number)', async () => {
    const zToken = await login('z19empty.qa@sportclan.test', 'SportClanZ19pass');
    const meId = (await call('GET', '/users/me', zToken)).data.user.id;
    const prof = (await call('GET', `/users/${meId}/sport-profile/${cricketId}`, token)).data.profile;
    expect(prof.cityRank).toBeNull();
    expect(prof.globalRank).toBeNull(); // SC-328: was a fake #4487 for an unplayed sport
  });
});
