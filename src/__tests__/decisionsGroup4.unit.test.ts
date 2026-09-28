/**
 * Dipak's decisions, group 4 (29 Sep 2026) — see the app repo's
 * phase3/DECISIONS.md. Item 18 (PATCH /matches/:id sets no result) is tested
 * in phase3MatchesB05.unit.test.ts beside the B05-F2 checks.
 *   15 · signing out one device stops its access token at once (sid deny list,
 *        Upstash Redis shared, this process as backup, fails open)
 *   17 · season medals and the season rank: live, real players only
 *   19 · /dev exists only outside production
 * Supabase is mocked: each from() logs its builder calls into `mockLog` and
 * resolves to `mockNext(q)`.
 */
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';

type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'range', 'gt', 'gte', 'lt', 'upsert', 'insert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start) } };
});
// A fake Upstash: a Map, plus switches to make it fail.
const mockKv = new Map<string, string>();
const mockRedis = {
  failGet: false,
  failSet: false,
  get: jest.fn(async (k: string) => { if (mockRedis.failGet) throw new Error('redis down'); return mockKv.get(k) ?? null; }),
  set: jest.fn(async (k: string, v: string) => { if (mockRedis.failSet) throw new Error('redis down'); mockKv.set(k, v); return 'OK'; }),
};
jest.mock('@upstash/redis', () => ({ Redis: jest.fn(() => mockRedis) }));
let mockRevoked = false;
jest.mock('../utils/sessionRevocation', () => ({
  isTokenRevoked: jest.fn(async () => mockRevoked),
  revokeSessionsNow: jest.fn(async () => 1_700_000_000_500),
}));
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(), notifyUser: jest.fn() }));
let mockTestFlag = true;
jest.mock('../utils/testContent', () => ({
  testFlagReady: jest.fn(async () => mockTestFlag),
  hideTestFor: jest.fn(async () => true),
}));

// eslint-disable-next-line import/first
import { generateAccessToken, generateAccessTokenAt, verifyAccessToken, ACCESS_TOKEN_TTL_SECONDS } from '../utils/jwt';
// eslint-disable-next-line import/first
import { denySessions, isSessionDenied, CHECK_TTL_MS, __resetSessionDeny } from '../utils/sessionDeny';
// eslint-disable-next-line import/first
import { authenticateToken } from '../middleware/auth.middleware';
// eslint-disable-next-line import/first
import { insertRefreshToken } from '../utils/sessionDevice';
// eslint-disable-next-line import/first
import { logout, refresh } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { revokeSession, revokeAllSessions } from '../controllers/account.controller';
// eslint-disable-next-line import/first
import { endSeason, getCurrentSeason } from '../controllers/seasons.controller';
// eslint-disable-next-line import/first
import { revokeSessionsNow } from '../utils/sessionRevocation';

const ME = '11111111-1111-4111-8111-111111111111';
const SID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SID2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => {
  const r = res();
  await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, ...req }, r);
  return r;
};
const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ENV = { ...process.env };
const withRedis = () => {
  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  __resetSessionDeny();
};

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockKv.clear();
  mockRedis.failGet = false;
  mockRedis.failSet = false;
  mockRedis.get.mockClear();
  mockRedis.set.mockClear();
  mockRevoked = false;
  mockTestFlag = true;
  process.env = { ...ENV };
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  __resetSessionDeny();
  jest.useRealTimers();
});
afterAll(() => { process.env = ENV; });

describe('15 · access tokens carry the sign-in they belong to', () => {
  test('sid when given, none otherwise (never `sid: undefined`)', () => {
    expect(verifyAccessToken(generateAccessToken(ME, SID)).sid).toBe(SID);
    expect('sid' in (jwt.decode(generateAccessToken(ME)) as object)).toBe(false);
    expect('sid' in (jwt.decode(generateAccessToken(ME, null)) as object)).toBe(false);
    const at = verifyAccessToken(generateAccessTokenAt(ME, Math.floor(Date.now() / 1000), SID));
    expect(at.sid).toBe(SID);
  });
  test('the deny list lasts a whole access-token life (15 minutes by default)', () => {
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(900);
  });
  test('a sign-in stores its row and hands back the id; the pre-100 fallback does too', async () => {
    mockNext = (q) => (q[0] === 'from:refresh_tokens' ? { data: { id: SID } } : {});
    expect(await insertRefreshToken(ME, 'rt', { headers: {} })).toBe(SID);
    let n = 0;
    mockNext = () => (++n === 1 ? { error: { message: 'column device_name does not exist' } } : { data: { id: SID2 } });
    expect(await insertRefreshToken(ME, 'rt', { headers: {} })).toBe(SID2);
    expect(mockLog.filter((q) => q[0] === 'from:refresh_tokens')).toHaveLength(3);
  });
  test('the three sign-ins sign their access token with that id', () => {
    const a = src('controllers/auth.controller.ts');
    expect((a.match(/const sid = await insertRefreshToken\(user\.id, refreshToken, req\);[^\n]*\n\s*const accessToken = generateAccessToken\(user\.id, sid\);/g) ?? []).length).toBe(3);
    expect(a).not.toMatch(/generateAccessToken\(user\.id\)/);
  });
  test('a refresh re-issues with the refresh token\'s own row id', async () => {
    const rt = jwt.sign({ userId: ME }, process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me', { expiresIn: '30d' });
    mockNext = (q) => (q[0] === 'from:refresh_tokens' && q.some((c) => c.startsWith('maybeSingle')) ? { data: { id: SID, revoked: false } } : {});
    const r = await call(refresh, { body: { refreshToken: rt } });
    expect(r.statusCode).toBe(200);
    expect(verifyAccessToken(r.body.accessToken).sid).toBe(SID);
  });
});

describe('15 · the deny list, without Redis (the local check server)', () => {
  test('a denied sid is refused; another sid, or none, is not', async () => {
    await denySessions([SID, null, undefined, SID]);
    expect(await isSessionDenied(SID)).toBe(true);
    expect(await isSessionDenied(SID2)).toBe(false);
    expect(await isSessionDenied(undefined)).toBe(false);
  });
  test('it runs out after one token life plus a minute', async () => {
    jest.useFakeTimers({ now: 1_700_000_000_000 });
    await denySessions([SID]);
    jest.setSystemTime(1_700_000_000_000 + (ACCESS_TOKEN_TTL_SECONDS + 59) * 1000);
    expect(await isSessionDenied(SID)).toBe(true);
    jest.setSystemTime(1_700_000_000_000 + (ACCESS_TOKEN_TTL_SECONDS + 61) * 1000);
    expect(await isSessionDenied(SID)).toBe(false);
  });
});

describe('15 · the deny list, with Upstash Redis (Render)', () => {
  test('a deny is written to Redis with the TTL', async () => {
    withRedis();
    await denySessions([SID]);
    expect(mockRedis.set).toHaveBeenCalledWith(`sdeny:${SID}`, '1', { ex: ACCESS_TOKEN_TTL_SECONDS + 60 });
  });
  test('another instance\'s deny is seen here (one GET)', async () => {
    withRedis();
    mockKv.set(`sdeny:${SID}`, '1');
    expect(await isSessionDenied(SID)).toBe(true);
    expect(await isSessionDenied(SID)).toBe(true);
    expect(mockRedis.get).toHaveBeenCalledTimes(1); // then remembered here
  });
  test('"not denied" is reused for CHECK_TTL_MS, then asked again', async () => {
    withRedis();
    jest.useFakeTimers({ now: 1_700_000_000_000 });
    expect(await isSessionDenied(SID)).toBe(false);
    expect(await isSessionDenied(SID)).toBe(false);
    expect(mockRedis.get).toHaveBeenCalledTimes(1);
    jest.setSystemTime(1_700_000_000_000 + CHECK_TTL_MS + 1);
    mockKv.set(`sdeny:${SID}`, '1');
    expect(await isSessionDenied(SID)).toBe(true);
    expect(mockRedis.get).toHaveBeenCalledTimes(2);
  });
  test('a deny made HERE bites at once, even inside the reuse window', async () => {
    withRedis();
    expect(await isSessionDenied(SID)).toBe(false);
    await denySessions([SID]);
    expect(await isSessionDenied(SID)).toBe(true);
  });
  test('Redis down on the check → allowed (fails open), and logged', async () => {
    withRedis();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRedis.failGet = true;
    expect(await isSessionDenied(SID)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[sessionDeny] deny check failed'), 'redis down');
    warn.mockRestore();
  });
  test('Redis down on the deny → still refused on this instance', async () => {
    withRedis();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRedis.failSet = true;
    await denySessions([SID]);
    expect(await isSessionDenied(SID)).toBe(true);
    warn.mockRestore();
  });
});

describe('15 · authenticateToken', () => {
  const run = async (token: string) => {
    const r = res();
    const next = jest.fn();
    await authenticateToken({ headers: { authorization: `Bearer ${token}` } } as any, r, next);
    return { r, next };
  };
  test('a signed-out session\'s token → 401 SESSION_REVOKED', async () => {
    await denySessions([SID]);
    const { r, next } = await run(generateAccessToken(ME, SID));
    expect([r.statusCode, r.body.code]).toEqual([401, 'SESSION_REVOKED']);
    expect(next).not.toHaveBeenCalled();
  });
  test('another session of the same account carries on', async () => {
    await denySessions([SID]);
    const { next } = await run(generateAccessToken(ME, SID2));
    expect(next).toHaveBeenCalled();
  });
  test('an old token with no sid carries on until it expires', async () => {
    await denySessions([SID]);
    const { next } = await run(generateAccessToken(ME));
    expect(next).toHaveBeenCalled();
  });
  test('the per-account cutoff (sign out all, reset) still applies', async () => {
    mockRevoked = true;
    const { r } = await run(generateAccessToken(ME, SID2));
    expect(r.statusCode).toBe(401);
  });
});

describe('15 · every way to sign one device out denies its session', () => {
  test('Active sessions › Sign out: the deleted row\'s id is denied', async () => {
    mockNext = (q) => (q[0] === 'from:refresh_tokens' ? { data: [{ id: SID }] } : {});
    const r = await call(revokeSession, { params: { sessionId: SID } });
    expect(r.statusCode).toBe(200);
    expect(await isSessionDenied(SID)).toBe(true);
  });
  test('…a session that isn\'t yours → 404, nothing denied', async () => {
    mockNext = () => ({ data: [] });
    const r = await call(revokeSession, { params: { sessionId: SID } });
    expect(r.statusCode).toBe(404);
    expect(await isSessionDenied(SID)).toBe(false);
  });
  test('Log out: the signed-out row\'s id is denied', async () => {
    mockNext = (q) => (q[0] === 'from:refresh_tokens' ? { data: [{ id: SID }] } : {});
    const r = await call(logout, { body: { refreshToken: 'rt' } });
    expect(r.body).toEqual({ success: true });
    expect(await isSessionDenied(SID)).toBe(true);
    expect(mockLog[0].join()).toContain('update:[{"revoked":true}]');
  });
  test('…a log-out with no refresh token denies nothing and still succeeds', async () => {
    const r = await call(logout, { body: {} });
    expect(r.body).toEqual({ success: true });
    expect(mockLog).toHaveLength(0);
  });
  test('Sign out all others: this phone\'s replacement token keeps its own sid', async () => {
    mockNext = (q) => (q[0] === 'from:refresh_tokens' && q.some((c) => c.startsWith('maybeSingle')) ? { data: { id: SID } } : {});
    const r = await call(revokeAllSessions, { headers: { 'x-refresh-token': 'mine' } });
    const t = jwt.decode(r.body.accessToken) as { sid?: string; iat: number }; // the mocked cutoff is in 2023
    expect(t.sid).toBe(SID);
    expect(t.iat).toBe(Math.floor(1_700_000_000_500 / 1000) + 1); // after the cutoff, as before
  });
  test('Suspending an account stops its access tokens too (the per-account cutoff)', () => {
    expect(src('controllers/admin.controller.ts')).toMatch(/if \(patch\.suspended_at\) \{[\s\S]{0,400}await revokeSessionsNow\(id\);/);
  });
  test('a reset (decision 8) and sign out all keep using the per-account cutoff', () => {
    expect(src('controllers/auth.controller.ts')).toMatch(/await revokeSessionsNow\(id\);/);
    expect(src('controllers/account.controller.ts')).toMatch(/const cutoffMs = await revokeSessionsNow\(userId\);/);
    expect(revokeSessionsNow).toBeDefined();
  });
  test('the app sends nothing new: no new header or body field is read', () => {
    const s = src('utils/sessionDeny.ts');
    expect(s).not.toMatch(/req\.|headers/);
  });
});

describe('17 · season medals and rank: live, real players only', () => {
  const season = { id: 'season-1', name: 'Season 1', season_number: 1, is_active: true };
  const endReq = { headers: { 'x-admin-key': 'k' } };
  beforeEach(() => { process.env.ADMIN_KEY = 'k'; });
  test('the medal query drops deleted and test accounts BEFORE the top-3 limit', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:seasons' && q.some((c) => c.startsWith('maybeSingle'))) return { data: season };
      if (q[0] === 'from:sports') return { data: [{ id: 'cricket', name: 'Cricket' }] };
      if (q[0] === 'from:user_sport_profiles') return { data: [{ user_id: 'u1', rating: 1500, u: { deleted_at: null, is_test_seed: false } }] };
      return {};
    };
    const r = await call(endSeason, endReq);
    expect(r.body.medalsAwarded).toBe(1);
    const q = mockLog.find((x) => x[0] === 'from:user_sport_profiles')!;
    const at = (s: string) => q.findIndex((c) => c.startsWith(s));
    expect(q.join()).toContain('u:users!user_id!inner(deleted_at, is_test_seed)');
    expect(q).toContain('is:["u.deleted_at",null]');
    expect(q).toContain('eq:["u.is_test_seed",false]');
    expect(q).toContain('gt:["matches_played",0]');
    expect(at('is:["u.deleted_at"')).toBeLessThan(at('limit:'));
    expect(at('eq:["u.is_test_seed"')).toBeLessThan(at('limit:'));
    const medal = mockLog.find((x) => x[0] === 'from:season_medals')!.join();
    expect(medal).toContain('"user_id":"u1"');
    expect(medal).not.toContain('"u":'); // the join isn't stored
  });
  test('before the test flag exists, deleted accounts are still dropped', async () => {
    mockTestFlag = false;
    mockNext = (q) => {
      if (q[0] === 'from:seasons' && q.some((c) => c.startsWith('maybeSingle'))) return { data: season };
      if (q[0] === 'from:sports') return { data: [{ id: 'cricket', name: 'Cricket' }] };
      return {};
    };
    await call(endSeason, endReq);
    const q = mockLog.find((x) => x[0] === 'from:user_sport_profiles')!;
    expect(q).toContain('is:["u.deleted_at",null]');
    expect(q.join()).not.toContain('is_test_seed');
  });
  test('the season rank counts only live players with a match played (the leaderboard\'s rule)', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:user_sport_profiles' && q.some((c) => c.startsWith('eq:["user_id"'))) return { data: [{ sport_id: 'cricket', rating: 1400, matches_played: 3, wins: 1 }] };
      if (q[0] === 'from:user_sport_profiles') return { count: 4 };
      return {};
    };
    const r = await call(getCurrentSeason, {});
    expect(r.body.sport_stats[0].rank).toBe(5);
    const q = mockLog.filter((x) => x[0] === 'from:user_sport_profiles')[1];
    expect(q).toContain('is:["tu.deleted_at",null]');
    expect(q).toContain('gt:["matches_played",0]');
    expect(q).toContain('eq:["tu.is_test_seed",false]');
  });
  test('/seasons/end is still admin-key only and is not run by anything here', async () => {
    const r = await call(endSeason, { headers: {} });
    expect(r.statusCode).toBe(403);
    expect(mockLog).toHaveLength(0);
  });
});

describe('19 · /dev only outside production', () => {
  const idx = src('index.ts');
  test('mounted behind NODE_ENV, and /internal/jobs unchanged', () => {
    expect(idx).toContain("if (process.env.NODE_ENV !== 'production') app.use('/dev', devRoutes);");
    expect(idx).not.toMatch(/^app\.use\('\/dev', devRoutes\);$/m);
    expect(idx).toContain("app.use('/internal/jobs', jobsRoutes);");
  });
});
