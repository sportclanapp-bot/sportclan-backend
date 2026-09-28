/**
 * Phase 4 · K2 — regression tests for the unified search fixes (see the app
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
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q }));
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => new Set()) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s?: string) => (s ? '99999999-9999-4999-8999-999999999999' : undefined)) }));

// eslint-disable-next-line import/first
import { search } from '../controllers/search.controller';
// eslint-disable-next-line import/first
import { escapeLike, orIlikeContains } from '../utils/likeSearch';

const ME = '11111111-1111-4111-8111-111111111111';
const D = '22222222-2222-4222-8222-222222222222';
const SPORT = '99999999-9999-4999-8999-999999999999';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (query: object) => { const r = res(); await search({ userId: ME, params: {}, query, body: {}, headers: {} } as any, r); return r; };
const main = () => mockLog.find((q) => q.some((c) => c.startsWith('range:')))!;
const TABS = ['players', 'teams', 'tournaments', 'umpires', 'coaches', 'posts', 'businesses', 'associations', 'clubs', 'leagues', 'other'];

beforeEach(() => { mockLog = []; mockNext = () => ({ data: [] }); });

describe('K2-44 · search input can’t inject filter syntax or LIKE wildcards (SC-237)', () => {
  it('K2-44a (301c704): %, _ and \\ are escaped; the .or() value is double-quoted so , ( ) . are literal', () => {
    expect(escapeLike('50%_a\\b')).toBe('50\\%\\_a\\\\b');
    expect(orIlikeContains(['username', 'name'], 'a,b).c')).toBe('username.ilike."%a,b).c%",name.ilike."%a,b).c%"');
  });
  it('K2-44a (301c704): a player search for "x),id.eq.(y" builds a quoted, non-injectable filter', async () => {
    await call({ q: 'x),id.eq.(y', tab: 'players' });
    const or = main().find((c) => c.startsWith('or:'))!;
    expect(or).toBe(`or:${JSON.stringify([orIlikeContains(['username', 'name'], 'x),id.eq.(y')])}`);
  });
  it.each(['teams', 'tournaments', 'posts'])('K2-44a (301c704): %s ilike escapes a bare %%', async (tab) => {
    await call({ q: '%', tab });
    expect(main().find((c) => c.startsWith('ilike:'))).toMatch(/"%\\\\%%"/);
  });
});

describe('K2-44b / K2-45 · the player search honours sport_id, in one DB-side join (SC-238)', () => {
  it('K2-44b/K2-45 (301c704, ff61397): user_sports!inner + .eq(sports.sport_id), no .in() pre-fetch', async () => {
    await call({ q: 'dip', tab: 'players', sport_id: 'cricket' });
    const q = main();
    expect(q.find((c) => c.startsWith('select:'))).toContain('sports:user_sports!inner(');
    expect(q).toContain(`eq:["sports.sport_id","${SPORT}"]`);
    expect(mockLog.filter((x) => x[0] === 'from:user_sports')).toHaveLength(0);
  });
  it('K2-45 (ff61397): without a sport the join stays optional', async () => {
    await call({ q: 'dip', tab: 'players' });
    expect(main().find((c) => c.startsWith('select:'))).not.toContain('!inner(sport_id');
  });
});

describe('K2-68 / K2-69 · every search tab pages by offset on a total order (SC-303)', () => {
  it.each(TABS)('K2-68 (0a3bbbc) / K2-69 (1f18640): %s — .range(offset…) and an id tie-breaker; has_more on a full page', async (tab) => {
    mockNext = (q) => (q.some((c) => c.startsWith('range:')) ? { data: [{ id: D }, { id: ME }] } : { data: [] });
    const r = await call({ q: 'an', tab, limit: '2', offset: '4' });
    const q = main();
    expect(q).toContain('range:[4,5]');
    expect(q).toContain('order:["id",{"ascending":true}]');
    expect(r.body.has_more).toBe(true);
  });
});

describe('K2-36b · post search respects the scheduled-post embargo (SC-218)', () => {
  it('K2-36b (65f062b): someone else’s future-scheduled post is dropped; my own is kept', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    mockNext = (q) => (q[0] === 'from:community_posts'
      ? { data: [{ id: 'p1', author_id: D, scheduled_at: future }, { id: 'p2', author_id: ME, scheduled_at: future }, { id: 'p3', author_id: D, scheduled_at: null }] }
      : { data: [] });
    const r = await call({ q: 'gg', tab: 'posts' });
    expect(r.body.data.map((p: any) => p.id)).toEqual(['p2', 'p3']);
  });
});
