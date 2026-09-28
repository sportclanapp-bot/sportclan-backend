/**
 * Phase 4 · K2 — regression tests for the leaderboard rank fixes (see the app
 * repo's phase4/K2.md). Supabase is mocked: every `from()` starts its own
 * query, resolved by `mockNext(q)`.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert']) {
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
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), testUserIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/activeUser', () => ({ ...jest.requireActual('../utils/activeUser'), deletedIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => '99999999-9999-4999-8999-999999999999') }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), isSportInactive: jest.fn(async () => false) }));

// eslint-disable-next-line import/first
import { getLeaderboard } from '../controllers/leaderboard.controller';

const ME = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (query: object) => { const r = res(); await getLeaderboard({ userId: ME, params: {}, query: { sport_id: 'cricket', ...query }, headers: {} } as any, r); return r; };
const has = (q: Q, s: string) => q.some((c) => c.includes(s));

// A 1500, B 1400, C 1400 (tie), ME 1300 — in the DB's tie-broken order.
const ALL = [
  { user_id: A, rating: 1500, matches_played: 9, wins: 6 },
  { user_id: B, rating: 1400, matches_played: 8, wins: 5 },
  { user_id: C, rating: 1400, matches_played: 7, wins: 4 },
  { user_id: ME, rating: 1300, matches_played: 5, wins: 2 },
];
const allTime = (from: number, to: number) => (q: Q) => {
  if (q[0] !== 'from:user_sport_profiles') return { data: [] };
  const gt = q.find((c) => c.startsWith('gt:["rating"'));
  if (gt) return { count: ALL.filter((r) => r.rating > JSON.parse(gt.slice(3))[1]).length };
  if (has(q, '{"count":"exact","head":true}')) return { count: ALL.length };
  if (has(q, `eq:["user_id","${ME}"]`)) return { data: ALL[3] };
  return { data: ALL.slice(from, to + 1) };
};

beforeEach(() => { mockLog = []; });

describe('K2-20 · the list uses competition rank, same as `me` (SC-132)', () => {
  it('K2-20 (93eef40): all-time — a tie shares one rank and the next rank skips (1, 2, 2, 4); me agrees', async () => {
    mockNext = allTime(0, 3);
    const r = await call({ limit: '4' });
    expect(r.body.leaderboard.map((e: any) => e.rank)).toEqual([1, 2, 2, 4]);
    expect(r.body.me.rank).toBe(4);
  });
  it('K2-20 (93eef40): all-time — a tie that spans a page boundary keeps the shared number on page 2', async () => {
    mockNext = allTime(2, 3);
    const r = await call({ limit: '2', offset: '2' });
    expect(r.body.leaderboard.map((e: any) => [e.user_id ?? e.id, e.rank])).toEqual([[C, 2], [ME, 4]]);
  });
  it('K2-20 (93eef40): monthly — ties share the rank in the list and in `me`', async () => {
    mockNext = (q) => (q[0] === 'from:rating_history'
      ? { data: [{ user_id: A, new_rating: 1500 }, { user_id: ME, new_rating: 1400 }, { user_id: B, new_rating: 1400 }] }
      : { data: [] });
    const r = await call({ period: 'monthly' });
    const ranks = Object.fromEntries(r.body.leaderboard.map((e: any) => [e.user_id ?? e.id, e.rank]));
    expect(ranks).toEqual({ [A]: 1, [B]: 2, [ME]: 2 });
    expect(r.body.me.rank).toBe(2);
  });
});
