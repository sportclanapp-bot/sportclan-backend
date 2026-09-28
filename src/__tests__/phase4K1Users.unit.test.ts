/**
 * Phase 4 · K1 — early users / account / services fixes.
 * Supabase is mocked: every `from()` starts its own query and resolves to
 * `mockNext(q)`, where `q` lists that query's builder calls.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'ilike', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'range', 'gte', 'gt', 'lt', 'upsert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../middleware/admin.middleware', () => ({ ...jest.requireActual('../middleware/admin.middleware'), isAdminUser: jest.fn(async () => false) }));
jest.mock('../utils/officiated', () => ({ officiatedCount: jest.fn(async () => 0) }));
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  blockedUserIds: jest.fn(async () => []),
  targetUserHidden: jest.fn(async () => false),
  isBlockedBetween: jest.fn(async () => false),
}));
jest.mock('../utils/testContent', () => ({
  hideTestFor: jest.fn(async () => false),
  excludeTest: jest.fn((q: unknown) => q),
  excludeTestEmbed: jest.fn((q: unknown) => q),
  testUserIdSet: jest.fn(async () => new Set()),
}));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => 'sport-cricket') }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), isSportInactive: jest.fn(async () => false) }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'cricket' })) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn() }));

// eslint-disable-next-line import/first
import { getMe, getUserById, updateAccountTypes, getSportProfile } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { getSessions } from '../controllers/account.controller';
// eslint-disable-next-line import/first
import servicesRouter from '../routes/services.routes';

const ME = '11111111-1111-4111-8111-111111111111';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => {
  const r = res();
  await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, ...req }, r);
  return r;
};

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
});

describe('K1-10 (582df08) · Active sessions come from refresh_tokens', () => {
  test('K1-10 (582df08): reads the caller\'s refresh_tokens (not the unused sessions table) and lists them', async () => {
    mockNext = (q) => (q[0] === 'from:refresh_tokens'
      ? { data: [{ id: 's1', token: 't1', created_at: '2026-09-28T10:00:00Z', device_name: 'Pixel 7' }] }
      : { data: null });
    const r = await call(getSessions, { headers: { 'x-refresh-token': 't1' } });
    expect(mockLog.map((q) => q[0])).toContain('from:refresh_tokens');
    expect(mockLog.map((q) => q[0])).not.toContain('from:sessions');
    expect(mockLog.find((q) => q[0] === 'from:refresh_tokens')).toContain(`eq:["user_id","${ME}"]`);
    expect(r.body.sessions).toEqual([expect.objectContaining({ id: 's1', is_current: true })]);
  });
});

describe('K1-30f (48f4849, A6-010) · changing account types never leaves an empty set', () => {
  test('K1-30f (48f4849): the insert fails → the previous rows are put back', async () => {
    let inserts = 0;
    mockNext = (q) => {
      if (q[0] !== 'from:user_account_types') return { data: null };
      if (q.some((c) => c.startsWith('insert:'))) {
        inserts += 1;
        return inserts === 1 ? { error: { message: 'boom' } } : { data: null };
      }
      if (q.some((c) => c.startsWith('delete:'))) return { data: null };
      return { data: [{ account_type: 'player' }, { account_type: 'coach' }] }; // the snapshot
    };
    const r = await call(updateAccountTypes, { body: { account_types: ['umpire'] } });
    expect(r.statusCode).toBe(500);
    const ins = mockLog.filter((q) => q[0] === 'from:user_account_types' && q.some((c) => c.startsWith('insert:')));
    expect(ins).toHaveLength(2);
    expect(JSON.parse(ins[1].find((c) => c.startsWith('insert:'))!.slice(7))).toEqual([
      { user_id: ME, account_type: 'player' },
      { user_id: ME, account_type: 'coach' },
    ]);
  });
});

describe('K1-30g (48f4849, A6-002) · /users/me never surfaces the legacy "fan" type', () => {
  test('K1-30g (48f4849): no join rows and account_type "fan" → account_types ["player"]', async () => {
    mockNext = (q) => (q[0] === 'from:users' && q.some((c) => c.startsWith('maybeSingle'))
      ? { data: { id: ME, account_type: 'fan', name: 'A', username: 'a' } }
      : { data: [] });
    const r = await call(getMe, {});
    expect(r.statusCode).toBe(200);
    expect(r.body.user.account_types).toEqual(['player']);
  });
});

describe('K1-30j (48f4849, A11-002) · GET /users/:id with a non-UUID id', () => {
  test('K1-30j (48f4849): is a clean 404 before any query (was a 500 on the uuid cast)', async () => {
    const r = await call(getUserById, { params: { id: 'search' } });
    expect(r.statusCode).toBe(404);
    expect(r.body).toEqual({ error: 'User not found' });
    expect(mockLog).toHaveLength(0);
  });
});

describe('K1-30e (48f4849, A6-008/009) · the services directory offers every non-player type', () => {
  const handler = () => {
    const layer = (servicesRouter as any).stack.find((l: any) => l.route?.path === '/' && l.route.methods.get);
    const hs = layer.route.stack.map((s: any) => s.handle);
    return hs[hs.length - 1];
  };
  test.each(['organiser', 'association', 'club', 'leagues', 'other', 'coach', 'umpire'])('K1-30e (48f4849): ?type=%s is accepted', async (type) => {
    mockNext = () => ({ data: [], count: 0 });
    const r = await call(handler(), { query: { type } });
    expect(r.statusCode).toBe(200);
  });
  test.each(['referee', 'trainer', 'player'])('K1-30e (48f4849): ?type=%s (non-canonical / not a service) is a 400', async (type) => {
    const r = await call(handler(), { query: { type } });
    expect(r.statusCode).toBe(400);
  });
});

describe('K1-33 (846ad07) · bowling economy reads overs in cricket notation', () => {
  test('K1-33 (846ad07): 0.4 overs (4 balls) for 24 runs is an economy of 36, not 60', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:user_sport_profiles' && q.some((c) => c.startsWith('maybeSingle'))) return { data: { rating: 1200, matches_played: 1 } };
      if (q[0] === 'from:match_participants') return { data: [{ match_id: 'm1' }] };
      if (q[0] === 'from:innings_stats') return { data: [{ runs: 0, balls_faced: 0, is_out: false, bowling_overs: 0.4, bowling_runs: 24, bowling_wickets: 1 }] };
      return { data: null };
    };
    const r = await call(getSportProfile, { params: { id: ME, sportId: 'cricket' } });
    expect(r.statusCode).toBe(200);
    expect(r.body.profile.sportStats.bowling_economy).toBe(36);
  });
});
