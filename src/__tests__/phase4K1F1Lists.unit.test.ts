/**
 * Phase 4 · K1 (rows K1-34, K1-41c, K1-43) — list endpoints page past 100 and
 * say how many there are; an offset past the end is an empty page, not a 500;
 * an unknown leaderboard sport is a 400.
 * Supabase is mocked: every from() starts its own query, resolved by mockNext(q).
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number | null } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'filter', 'contains']) {
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
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s?: string) => (s === 'cricket' ? 'sport-cricket' : undefined)) }));
jest.mock('../utils/sports', () => ({
  ...jest.requireActual('../utils/sports'),
  isSportInactive: jest.fn(async () => false),
  activeSportIds: jest.fn(async () => null),
  validateSportForCreate: jest.fn(async () => null),
}));
jest.mock('../utils/teamNames', () => ({ attachTeamNames: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { parsePagination, pageMeta, isRangeError } from '../utils/pagination';
// eslint-disable-next-line import/first
import { listTeams } from '../controllers/teams.controller';
// eslint-disable-next-line import/first
import { listMatches } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { listTournaments } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { getLeaderboard } from '../controllers/leaderboard.controller';

const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, query: object) => { const r = res(); await fn({ userId: 'me', params: {}, query, body: {} }, r); return r; };
const PAST_END = { data: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' }, count: null };

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('K1-34a (9cf1d71) · the shared pagination contract', () => {
  it('K1-34a (9cf1d71): limit/offset map to an inclusive range, capped; the envelope has total and has_more', () => {
    expect(parsePagination({ limit: '20', offset: '40' })).toEqual({ limit: 20, offset: 40, from: 40, to: 59 });
    expect(parsePagination({ limit: '5000' }).limit).toBe(100);
    expect(parsePagination({ limit: '-3', offset: 'x' })).toMatchObject({ limit: 100, offset: 0 });
    expect(pageMeta(250, parsePagination({ limit: '100', offset: '100' }))).toEqual({ total: 250, limit: 100, offset: 100, has_more: true });
    expect(pageMeta(250, parsePagination({ limit: '100', offset: '200' })).has_more).toBe(false);
  });

  const lists: Array<[string, any, string, string]> = [
    ['teams', listTeams, 'teams', 'from:teams'],
    ['matches', listMatches, 'matches', 'from:matches'],
    ['tournaments', listTournaments, 'tournaments', 'from:tournaments'],
  ];
  it.each(lists)('K1-34a (9cf1d71): %s — the page is range()d past 100 and the true total comes back', async (_n, fn, key, table) => {
    mockNext = (q) => (q[0] === table ? { data: [{ id: 't1' }], count: 437 } : { data: [] });
    const r = await call(fn, { limit: '100', offset: '300' });
    expect(r.statusCode).toBe(200);
    expect(r.body[key]).toHaveLength(1);
    expect(r.body).toMatchObject({ total: 437, limit: 100, offset: 300, has_more: true });
    const q = mockLog.find((x) => x[0] === table)!.join(' ');
    expect(q).toContain('"count":"exact"');
    expect(q).toContain('range:[300,399]');
  });
});

describe('K1-43 (19156bb) · an offset past the end is an empty last page', () => {
  it('K1-43 (19156bb): isRangeError knows PostgREST 416', () => {
    expect(isRangeError({ code: 'PGRST103' })).toBe(true);
    expect(isRangeError({ message: 'Requested range not satisfiable' })).toBe(true);
    expect(isRangeError({ code: '42P01', message: 'boom' })).toBe(false);
    expect(isRangeError(null)).toBe(false);
  });
  it.each([
    ['teams', listTeams, 'teams', 'from:teams'],
    ['matches', listMatches, 'matches', 'from:matches'],
    ['tournaments', listTournaments, 'tournaments', 'from:tournaments'],
  ] as Array<[string, any, string, string]>)('K1-43 (19156bb): %s → 200 with an empty list, not 500', async (_n, fn, key, table) => {
    mockNext = (q) => (q[0] === table ? PAST_END : { data: [] });
    const r = await call(fn, { offset: '999999' });
    expect(r.statusCode).toBe(200);
    expect(r.body[key]).toEqual([]);
  });
  it('K1-43 (19156bb): leaderboard → 200 with an empty board', async () => {
    mockNext = (q) => (q[0] === 'from:user_sport_profiles' && q.some((c) => c.startsWith('range:')) ? PAST_END : { data: [] });
    const r = await call(getLeaderboard, { sport_id: 'cricket', offset: '999999' });
    expect(r.statusCode).toBe(200);
    expect(r.body.leaderboard).toEqual([]);
  });
  it('K1-41c (d5aa529): a huge offset is capped before it reaches the query', () => {
    expect(parsePagination({ offset: '99999999999999' }).offset).toBe(10_000_000);
  });
});

describe('K1-34b (9cf1d71) · leaderboard sport', () => {
  it('K1-34b (9cf1d71): an unknown sport is a 400 before any query', async () => {
    const r = await call(getLeaderboard, { sport_id: 'no-such-sport' });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('Unknown sport_id');
    expect(mockLog).toHaveLength(0);
  });
  it('K1-34b (9cf1d71): a slug is resolved and the ranking is filtered by the resolved id', async () => {
    mockNext = () => ({ data: [], count: 0 });
    const r = await call(getLeaderboard, { sport_id: 'cricket' });
    expect(r.statusCode).toBe(200);
    expect(mockLog.filter((q) => q[0] === 'from:user_sport_profiles').every((q) => q.join(' ').includes('"sport-cricket"'))).toBe(true);
  });
});
