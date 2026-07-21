/**
 * SC-336 · Advanced-stats form dots carry per-match detail — LIVE integration test.
 *
 * The last-10 form dots became tappable, which needs the endpoint to return per-match
 * detail (result + opponent + date), not just outcomes. Asserts getAdvancedStats
 * returns form.last10 as {result, opponent, at} objects and the trajectory as
 * {rating, at}. Premium viewer (z326agra) scouts a well-played user (Aarav).
 *
 * Read-only.
 */
import https from 'https';

const BASE = process.env.SC_BASE || 'https://sportclan-backend.onrender.com';
const AARAV = '5a9eaac3-dea0-4419-906c-911c5af9f38b';

function call(method: string, path: string, token?: string): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    const u = new URL(BASE + path);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve({ status: res.statusCode || 0, data: JSON.parse(b || '{}') }); } catch { resolve({ status: res.statusCode || 0, data: {} }); } }); },
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

describe('SC-336 advanced-stats per-match form detail', () => {
  let token: string;
  let cricketId: string;

  beforeAll(async () => {
    token = await login('z326agra.qa@sportclan.test', 'SportClanZ326pass');
    const sports = (await call('GET', '/sports', token)).data.sports as any[];
    cricketId = sports.find((s) => s.name === 'Cricket').id;
  });

  it('form.last10 is an array of {result, opponent, at}; trajectory is {rating, at}', async () => {
    const { status, data } = await call('GET', `/users/${AARAV}/advanced-stats?sport_id=${cricketId}`, token);
    expect(status).toBeLessThan(400); // premium viewer, not locked
    expect(data.form).toBeTruthy(); // Aarav has plenty of ranked cricket → not lowData
    const last10 = data.form.last10;
    expect(Array.isArray(last10)).toBe(true);
    expect(last10.length).toBeGreaterThan(0);
    expect(last10.length).toBeLessThanOrEqual(10);
    for (const m of last10) {
      expect(['W', 'L', 'D']).toContain(m.result);
      expect(m.opponent === null || typeof m.opponent === 'string').toBe(true); // string or null (unidentifiable)
      expect(typeof m.at).toBe('string');
      expect(isNaN(new Date(m.at).getTime())).toBe(false); // a real date the FE can format
    }
    // last10Wins still matches the outcomes.
    expect(data.form.last10Wins).toBe(last10.filter((m: any) => m.result === 'W').length);
    // trajectory carries per-point rating + date (drives the tappable sparkline).
    expect(Array.isArray(data.form.trajectory)).toBe(true);
    for (const t of data.form.trajectory) {
      expect(typeof t.rating).toBe('number');
      expect(typeof t.at).toBe('string');
    }
  });
});
