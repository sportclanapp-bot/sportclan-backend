/**
 * Phase 4 · K2 — regression tests for backend profile / user-read fixes (see
 * the app repo's phase4/K2.md). Supabase is mocked: every `from()` starts its
 * own query, resolved by `mockNext(q)` — a select naming a column that doesn't
 * exist can be made to error, as PostgREST does.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'contains', 'filter']) {
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
let mockBlocked = new Set<string>();
let mockBlockedPair = false;
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  blockedUserIds: jest.fn(async () => mockBlocked),
  isBlockedBetween: jest.fn(async () => mockBlockedPair),
  targetUserHidden: jest.fn(async () => false),
}));
jest.mock('../utils/testContent', () => ({
  hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()),
}));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s?: string) => (s ? '99999999-9999-4999-8999-999999999999' : undefined)) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), isSportInactive: jest.fn(async () => false) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(async () => undefined), notifyUsers: jest.fn(async () => undefined), notifyUnlessBlocked: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { getRival, getUserById, updateMe } from '../controllers/users.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PUNE = 'c1111111-1111-4111-8111-111111111111';
const MUMBAI = 'c2222222-2222-4222-8222-222222222222';
const DELHI = 'c3333333-3333-4333-8333-333333333333';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, ...req }, r); return r; };
const has = (q: Q, s: string) => q.some((c) => c.includes(s));

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockBlocked = new Set();
  mockBlockedPair = false;
});

describe('K2-33 · the rival search’s state tier works (cities has no state_id)', () => {
  it('K2-33 (c1f3b71): with no rival in my city, the closest one in my STATE beats a closer one elsewhere', async () => {
    const STATE: Record<string, string> = { [PUNE]: 'Maharashtra', [MUMBAI]: 'Maharashtra', [DELHI]: 'Delhi' };
    mockNext = (q) => {
      if (q[0] === 'from:cities') {
        if (has(q, 'state_id')) return { data: null, error: { code: '42703', message: 'column cities.state_id does not exist' } };
        const id = JSON.parse(q.find((c) => c.startsWith('eq:["id"'))!.slice(3))[1];
        return { data: { state: STATE[id] } };
      }
      if (q[0] === 'from:user_sport_profiles' && has(q, 'gt:["rating"')) {
        return { data: [{ user_id: A, rating: 1210, matches_played: 3, wins: 2 }, { user_id: B, rating: 1250, matches_played: 3, wins: 2 }] };
      }
      if (q[0] === 'from:user_sport_profiles') return { data: { rating: 1200, matches_played: 5 } };
      if (q[0] === 'from:users' && has(q, 'in:["id"')) return { data: [{ id: A, name: 'A', city_id: DELHI }, { id: B, name: 'B', city_id: MUMBAI }] };
      if (q[0] === 'from:users') return { data: { city_id: PUNE } };
      return { data: null };
    };
    const r = await call(getRival, { params: { id: ME }, query: { sport_id: 'cricket' } });
    expect(r.body.rival.user_id).toBe(B);
  });
});

describe('K2-37a · another user’s profile carries their full account-type set (SC-221)', () => {
  it('K2-37a (6dcd12a): getUserById returns account_types from the join table', async () => {
    mockNext = (q) => (q[0] === 'from:users' ? { data: { id: A, name: 'A', account_type: 'player' } }
      : q[0] === 'from:user_account_types' ? { data: [{ account_type: 'player' }, { account_type: 'coach' }] } : { data: null });
    const r = await call(getUserById, { params: { id: A } });
    expect(r.body.user?.account_types ?? r.body.account_types).toEqual(['player', 'coach']);
  });
});

describe('K2-51 · profile privacy and validation (SC-246/247/248)', () => {
  it('K2-51a (32b4ff4): another viewer’s read never selects phone, email, coins, referral code, admin flag or prefs', async () => {
    mockNext = (q) => (q[0] === 'from:users' ? { data: { id: A, name: 'A' } } : { data: [] });
    await call(getUserById, { params: { id: A } });
    const sel = mockLog.find((q) => q[0] === 'from:users')!.find((c) => c.startsWith('select:'))!;
    for (const col of ['phone', 'email', 'coin_balance', 'referral_code', 'is_admin', 'notification_preferences', 'password_hash']) {
      expect(sel).not.toMatch(new RegExp(`\\b${col}\\b`));
    }
  });
  it.each(['dip ak', 'dipak!', 'ab', 'x'.repeat(31), '😀😀😀'])('K2-51b (32b4ff4): updateMe username %j → 400 INVALID_USERNAME', async (username) => {
    const r = await call(updateMe, { body: { username } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'INVALID_USERNAME']);
  });
  it.each([
    ['2999-01-01', 'Date of birth can’t be in the future'],
    ['1850-01-01', 'Please enter a valid date of birth'],
    ['not-a-date', 'Date of birth is not a valid date'],
  ])('K2-51c (32b4ff4): updateMe dob %s → 400', async (dob, error) => {
    const r = await call(updateMe, { body: { dob } });
    expect([r.statusCode, r.body.error]).toEqual([400, error]);
  });
});
