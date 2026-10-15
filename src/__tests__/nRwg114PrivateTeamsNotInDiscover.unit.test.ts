/**
 * N-RWG1-14 (launch test plan): a private team showed in everyone's Discover and Sport Hub team
 * lists, and tapping it was a dead end — its page refuses anyone outside it (SC-107). Browse lists
 * are public teams only; "My teams" still lists the viewer's own private teams.
 * Supabase is mocked: every from() starts its own query, resolved by mockNext(q).
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
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s?: string) => (s ? `sport-${s}` : undefined)) }));
// eslint-disable-next-line import/first
import { listTeams } from '../controllers/teams.controller';

const teamsQuery = async (query: object) => {
  mockLog = [];
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  await listTeams({ userId: 'me', params: {}, query, body: {} } as never, r);
  expect(r.statusCode).toBe(200);
  return mockLog.find((q) => q[0] === 'from:teams')!.join(' ');
};

test.each([
  ['Discover', {}],
  ['Sport Hub teams', { sport_id: 'football' }],
  ['a name search', { q: 'Private' }],
])('%s lists public teams only', async (_n, query) => {
  expect(await teamsQuery(query)).toContain('eq:["is_public",true]');
});

test('My teams keeps the viewer’s own private teams', async () => {
  expect(await teamsQuery({ mine: '1' })).not.toContain('is_public');
});
