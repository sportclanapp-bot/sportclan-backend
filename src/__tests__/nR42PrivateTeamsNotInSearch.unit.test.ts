/**
 * N-R4-2 (launch test plan, Round 4, found while fixing N-RWG1-14): search's Teams tab still found
 * private teams by name for everyone, and tapping one hit the page that refuses anyone outside the
 * team (SC-107) — the same dead end N-RWG1-14 closed in Discover. Search finds public teams only; a
 * member finds their private team under "My teams".
 * Supabase is mocked: every from() starts its own query, recorded in mockLog.
 */
type Q = string[];
let mockLog: Q[] = [];
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'order', 'or', 'ilike', 'range']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: [], error: null, count: 0 }));
    return chain;
  };
  return { supabase: { from: jest.fn(start) } };
});
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s?: string) => (s ? `sport-${s}` : undefined)) }));
// eslint-disable-next-line import/first
import { search } from '../controllers/search.controller';

const teamsQuery = async (query: object) => {
  mockLog = [];
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  await search({ userId: 'me', params: {}, query: { tab: 'teams', ...query }, body: {} } as never, r);
  expect(r.statusCode).toBe(200);
  return mockLog.find((q) => q[0] === 'from:teams')!.join(' ');
};

test.each([
  ['a name', { q: 'Private' }],
  ['a name in one sport', { q: 'Private', sport_id: 'football' }],
])('searching teams by %s finds public teams only', async (_n, query) => {
  expect(await teamsQuery(query)).toContain('eq:["is_public",true]');
});
