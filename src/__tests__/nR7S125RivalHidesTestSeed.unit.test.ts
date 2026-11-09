/**
 * N-R7-S125 (B10 A1, SP-VBL-C26) · the rival card is a discovery read: a real
 * user is never offered a test player (is_test_seed) as the rival to chase,
 * like Rankings (B03). Test accounts still see each other. The filter is in the
 * query (an embedded users join), so the nearest-higher window isn't spent on
 * hidden rows. Supabase is mocked like phase4K2Profile.
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
let mockHide = false;
let mockBlocked = new Set<string>();
let mockBlockedPair = false;
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  blockedUserIds: jest.fn(async () => mockBlocked),
  isBlockedBetween: jest.fn(async () => mockBlockedPair),
  targetUserHidden: jest.fn(async () => false),
}));
jest.mock('../utils/testContent', () => ({
  hideTestFor: jest.fn(async () => mockHide), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()),
}));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s?: string) => (s ? '99999999-9999-4999-8999-999999999999' : undefined)) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), isSportInactive: jest.fn(async () => false) }));
let mockSlug = 'cricket';
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: mockSlug })) }));
jest.mock('../utils/matchCounts', () => ({
  ...jest.requireActual('../utils/matchCounts'),
  countParticipantsByMatch: jest.fn(async (ids: string[]) => new Map(ids.map((i) => [i, 2]))),
}));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(async () => undefined), notifyUsers: jest.fn(async () => undefined), notifyUnlessBlocked: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { getRival } from '../controllers/users.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const SEED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REAL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (req: object) => { const r = res(); await getRival({ userId: ME, params: { id: ME }, query: { sport_id: 'volleyball' }, body: {}, headers: {}, ...req } as any, r); return r; };
const has = (q: Q, s: string) => q.some((c) => c.includes(s));
// a mock that honours the test-seed filter wherever the controller puts it
const seedOut = (q: Q) => has(q, 'tu.is_test_seed') || has(q, '"is_test_seed",false');
beforeEach(() => {
  mockLog = []; mockBlocked = new Set();
  mockNext = (q) => {
    if (q[0] === 'from:user_sport_profiles' && has(q, 'gt:["rating"')) {
      const rows = [{ user_id: SEED, rating: 1251, matches_played: 3, wins: 2, tu: { is_test_seed: true, deleted_at: null } }, { user_id: REAL, rating: 1300, matches_played: 3, wins: 2, tu: { is_test_seed: false, deleted_at: null } }];
      return { data: has(q, 'tu.is_test_seed') ? rows.filter((r) => !r.tu.is_test_seed) : rows };
    }
    if (q[0] === 'from:user_sport_profiles') return { data: { rating: 1231, matches_played: 5 } };
    if (q[0] === 'from:users' && has(q, 'in:["id"')) {
      const us = [{ id: SEED, name: 'P3 SW Player 24', city_id: null, is_test_seed: true }, { id: REAL, name: 'Real Rival', city_id: null, is_test_seed: false }];
      return { data: seedOut(q) ? us.filter((u) => !u.is_test_seed) : us };
    }
    if (q[0] === 'from:users') return { data: { city_id: null } };
    return { data: null };
  };
});

test('a real viewer: the test player just above is skipped; the nearest real player is the rival', async () => {
  mockHide = true;
  const r = await call({});
  expect(r.body.rival?.user_id).toBe(REAL);
  const higher = mockLog.find((q) => q[0] === 'from:user_sport_profiles' && has(q, 'gt:["rating"'))!;
  expect(has(higher, 'tu.is_test_seed')).toBe(true); // in the query, not after the window
});

test('a test account still sees test players (nothing hidden)', async () => {
  mockHide = false;
  const r = await call({});
  expect(r.body.rival?.user_id).toBe(SEED);
});
