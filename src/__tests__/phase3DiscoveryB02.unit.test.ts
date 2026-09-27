/**
 * Phase 3 · B02 (Home & discovery), 28 Sep 2026 — the backend fixes.
 *  F1  Coaches/Clubs/Associations/Leagues/Umpires/Businesses filter the account
 *      type in the query, so a page is never empty while matches exist;
 *  F3  bad input is a 400 (search q/tab/sport_id, leaderboard sport_id,
 *      availability dates/sports/flags);
 *  F6  a deleted top candidate doesn't cost a sport its "most active" card;
 *  F7  monthly leaderboard: latest rating wins, and wins are null (unknown);
 *  F8  scorers: every completed match is counted (paged), and deleted scorers
 *      drop out before the top 20.
 */
type Result = { data?: unknown; error?: unknown; count?: number | null };
let results: Result[] = [];
let queries: string[][] = [];
jest.mock('../utils/supabase', () => {
  const make = () => {
    const log: string[] = [];
    queries.push(log);
    const q: any = {};
    for (const m of ['select', 'insert', 'update', 'upsert', 'eq', 'neq', 'is', 'in', 'gt', 'gte', 'lt', 'order', 'range', 'or', 'not', 'limit', 'ilike']) {
      q[m] = jest.fn((...a: unknown[]) => { log.push(`${m}:${JSON.stringify(a)}`); return q; });
    }
    const next = () => results.shift() ?? { data: null, error: null, count: 0 };
    q.maybeSingle = jest.fn(async () => next());
    q.single = jest.fn(async () => next());
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(next()).then(ok, bad);
    return q;
  };
  return { supabase: { from: jest.fn((t: string) => { const q = make(); queries[queries.length - 1].push(`from:${t}`); return q; }) } };
});
jest.mock('../utils/blocks', () => ({ blockedUserIds: jest.fn(async () => []), excludeIds: jest.fn((q: unknown) => q) }));
jest.mock('../utils/testContent', () => ({
  hideTestFor: jest.fn(async () => false), excludeTest: jest.fn((q: unknown) => q),
  excludeTestEmbed: jest.fn((q: unknown) => q), testUserIdSet: jest.fn(async () => new Set()),
}));
const mockDeleted = new Set<string>();
jest.mock('../utils/activeUser', () => ({
  excludeDeleted: jest.fn((q: unknown) => q), excludeDeletedEmbed: jest.fn((q: unknown) => q),
  deletedIdSet: jest.fn(async (ids: string[]) => new Set(ids.filter((i) => mockDeleted.has(i)))),
}));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s: string) => (s === 'cricket' ? '22222222-2222-4222-8222-222222222222' : undefined)) }));
jest.mock('../utils/sports', () => ({ isSportInactive: jest.fn(async () => false), activeSportIds: jest.fn(async () => []) }));

// eslint-disable-next-line import/first
import { search } from '../controllers/search.controller';
// eslint-disable-next-line import/first
import { getLeaderboard } from '../controllers/leaderboard.controller';
// eslint-disable-next-line import/first
import { updateAvailability } from '../controllers/availability.controller';
// eslint-disable-next-line import/first
import { getPlayerOfWeek } from '../controllers/features.controller';
// eslint-disable-next-line import/first
import { getScorerLeaderboard } from '../controllers/insights.controller';

const S = '22222222-2222-4222-8222-222222222222';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: 'me', params: {}, query: {}, body: {}, ...req }, r); return r; };

beforeEach(() => { results = []; queries = []; mockDeleted.clear(); });

describe('F1 · account-type tabs filter in the query', () => {
  test.each([
    ['clubs', 'eq:["acct.account_type","club"]'],
    ['coaches', 'eq:["acct.account_type","coach"]'],
    ['associations', 'eq:["acct.account_type","association"]'],
    ['leagues', 'eq:["acct.account_type","leagues"]'],
    ['businesses', 'eq:["acct.account_type","business"]'],
    ['umpires', 'in:["acct.account_type",'],
  ])('%s', async (tab, filter) => {
    results = [{ data: Array.from({ length: 20 }, (_, i) => ({ id: `u${i}`, name: 'an', acct: [{ account_type: 'x' }] })), error: null }];
    const r = await call(search, { query: { q: 'an', tab } });
    const log = queries[0].join(' ');
    expect(log).toContain('user_account_types!inner(account_type)');
    expect(log).toContain(filter);
    expect(log.indexOf(filter)).toBeLessThan(log.indexOf('range:'));
    expect(r.body.data).toHaveLength(20);
    expect(r.body.data[0].acct).toBeUndefined(); // the join column isn't returned
    expect(r.body.has_more).toBe(true);
  });
});

describe('F3 · bad input → 400', () => {
  test('search: a repeated q', async () => {
    expect((await call(search, { query: { q: ['a', 'b'] } })).statusCode).toBe(400);
  });
  test('search: an unknown sport', async () => {
    expect((await call(search, { query: { q: 'a', tab: 'teams', sport_id: 'notasport' } })).statusCode).toBe(400);
  });
  test('search: a sport slug resolves to its id', async () => {
    results = [{ data: [], error: null }];
    await call(search, { query: { q: 'a', tab: 'teams', sport_id: 'cricket' } });
    expect(queries[0].join(' ')).toContain(`eq:["sport_id","${S}"]`);
  });
  test('leaderboard: a repeated sport_id', async () => {
    expect((await call(getLeaderboard, { query: { sport_id: ['cricket', 'football'] } })).statusCode).toBe(400);
  });
  test.each([
    [{ date_from: 'notadate' }], [{ date_to: '2026-02-30' }], [{ date_from: '2026-10-05', date_to: '2026-10-01' }],
    [{ sport_ids: 'x' }], [{ sport_ids: ['notauuid'] }], [{ hide_stats: 'yes' }],
  ])('availability %j', async (body) => {
    const r = await call(updateAvailability, { body });
    expect(r.statusCode).toBe(400);
    expect(queries).toHaveLength(0);
  });
  test('availability: good input is saved', async () => {
    results = [{ data: { user_id: 'me' }, error: null }];
    const r = await call(updateAvailability, { body: { status: 'looking_to_play', sport_ids: [S], date_from: '2026-10-01', date_to: '2026-10-05', hide_stats: true } });
    expect(r.statusCode).toBe(200);
  });
});

describe('F6 · most active this week', () => {
  test('a deleted top candidate gives way to the next live player of that sport', async () => {
    mockDeleted.add('dead');
    results = [
      { data: [
        { user_id: 'dead', sport_id: S, rating: 2000, wins: 50, matches_played: 60 },
        { user_id: 'live', sport_id: S, rating: 1200, wins: 5, matches_played: 8 },
      ] },
      { data: null, error: { message: 'x' } }, // matchesThisWeek → unknown, no filter
      { data: [{ id: 'live', name: 'Live' }] },
    ];
    const r = await call(getPlayerOfWeek, { userId: 'f6-viewer' });
    expect(r.body.players.map((p: any) => p.user?.id)).toEqual(['live']);
  });
});

describe('F7 · monthly leaderboard', () => {
  test('rows are read oldest first, and wins are null', async () => {
    results = [{ data: [
      { user_id: 'a', delta: 10, new_rating: 1010, match: { id: 'm1' } },
      { user_id: 'a', delta: -5, new_rating: 1005, match: { id: 'm2' } },
    ], error: null }, { data: [{ id: 'a', name: 'A' }] }];
    const r = await call(getLeaderboard, { query: { sport_id: 'cricket', period: 'monthly' } });
    expect(queries[0].join(' ')).toContain('order:["created_at",{"ascending":true}]');
    expect(r.body.leaderboard[0].rating).toBe(1005);
    expect(r.body.leaderboard[0].wins).toBeNull();
  });
});

describe('F8 · scorers', () => {
  test('every page of completed matches is counted; deleted scorers drop out before the top 20', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ created_by: i < 600 ? 'dead' : `s${i % 25}` }));
    const page2 = Array.from({ length: 3 }, () => ({ created_by: 's1' }));
    const liveUsers = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, name: `S${i}` }));
    results = [{ data: page1 }, { data: page2 }, { data: liveUsers.slice(0, 20) }, { data: liveUsers.slice(20) }];
    const r = await call(getScorerLeaderboard, {});
    expect(queries[0].join(' ')).toContain('range:[0,999]');
    expect(queries[1].join(' ')).toContain('range:[1000,1999]');
    expect(r.body.scorers).toHaveLength(20);
    expect(r.body.scorers.every((s: any) => s.user.id !== 'dead')).toBe(true);
    const s1 = r.body.scorers.find((s: any) => s.user.id === 's1');
    expect(s1.matchesScored).toBe(16 + 3); // page 2 counted
  });
});
