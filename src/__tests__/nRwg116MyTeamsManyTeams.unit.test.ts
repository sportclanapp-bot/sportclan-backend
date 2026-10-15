/**
 * N-RWG1-16 (launch test plan): "My teams" was a 500 for anyone in a few hundred teams — the server
 * read every membership, then sent every team id back in one `.in('id', …)`, and the URL got too long.
 * The viewer's membership is an inner join filtered in the database now: one request, paged, with
 * the true total and the viewer's role on each row.
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
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'order', 'or', 'ilike', 'range']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, error: null, ...mockNext(q) }));
    return chain;
  };
  return { supabase: { from: jest.fn(start) } };
});
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { listTeams } from '../controllers/teams.controller';
// eslint-disable-next-line import/first
import { IN_CHUNK } from '../utils/inChunks';

const MANY = Array.from({ length: 1462 }, (_, i) => ({ team_id: `t${i}`, role: i === 0 ? 'captain' : 'player' }));
const call = async (query: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  await listTeams({ userId: 'me', params: {}, query, body: {} } as never, r);
  return r;
};

beforeEach(() => {
  mockLog = [];
  mockNext = (q) => {
    // The gateway refuses a URL with a few hundred ids in it.
    if (q.some((c) => c.startsWith('in:') && (JSON.parse(c.slice(3))[1] as unknown[]).length > IN_CHUNK)) return { error: { message: 'URI too long' } };
    if (q[0] === 'from:team_members') return { data: q.some((c) => c.startsWith('in:')) ? [{ team_id: 't0' }, { team_id: 't1' }] : MANY };
    if (q[0] === 'from:teams') {
      return {
        data: [
          { id: 't0', name: 'Pune XI', join_code: 'ABC234', city: { name: 'Pune' }, members: [{ count: 9 }], me: [{ role: 'captain', user_id: 'me' }] },
          { id: 't1', name: 'Nashik XI', join_code: 'XYZ789', city: null, members: [{ count: 3 }], me: [{ role: 'player', user_id: 'me' }] },
        ],
        count: 1462,
      };
    }
    return { data: [] };
  };
});

test('someone in 1,462 teams gets the first page and the true total, not a 500', async () => {
  const r = await call({ mine: '1', limit: '50' });
  expect(r.statusCode).toBe(200);
  expect(r.body).toMatchObject({ total: 1462, limit: 50, offset: 0, has_more: true });
  expect(r.body.teams.map((t: { id: string }) => t.id)).toEqual(['t0', 't1']);
});

test('no id list longer than a chunk goes into any request; the membership is filtered in the database', async () => {
  await call({ mine: '1', limit: '50' });
  for (const q of mockLog) {
    for (const c of q.filter((x) => x.startsWith('in:'))) {
      const ids = JSON.parse(c.slice(3))[1] as unknown[];
      expect(ids.length).toBeLessThanOrEqual(IN_CHUNK);
    }
  }
  const teams = mockLog.find((q) => q[0] === 'from:teams')!.join(' ');
  expect(teams).toContain('me:team_members!inner(role, user_id)');
  expect(teams).toContain('eq:["me.user_id","me"]');
  expect(teams).toContain('range:[0,49]');
});

test('each row carries the viewer’s role and their join code; the join itself is not sent back', async () => {
  const r = await call({ mine: '1' });
  expect(r.body.teams[0]).toMatchObject({ id: 't0', my_role: 'captain', join_code: 'ABC234', member_count: 9, city_name: 'Pune' });
  expect(r.body.teams[1]).toMatchObject({ id: 't1', my_role: 'player', member_count: 3 });
  expect(r.body.teams[0]).not.toHaveProperty('me');
});

test('the browse list is not joined to the viewer’s memberships', async () => {
  await call({ limit: '50' });
  const teams = mockLog.find((q) => q[0] === 'from:teams')!.join(' ');
  expect(teams).not.toContain('me:team_members');
  expect(teams).not.toContain('me.user_id');
});
