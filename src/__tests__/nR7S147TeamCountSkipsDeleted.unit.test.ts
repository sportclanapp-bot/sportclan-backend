/**
 * N-R7-S147 (Step 2 B14, X2-229): a member who deleted their account drops off the team's member
 * list (SC-79), but their team_members row is kept (B2-a), so the Teams list card, search and the
 * team's member_count still counted them: "11 members" on the card, 10 rows on the team page.
 * Every member count now leaves out deleted accounts.
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
jest.mock('../utils/teamRecord', () => ({ computeTeamRecord: jest.fn(async () => ({ played: 0, wins: 0, losses: 0, draws: 0, win_rate: 0 })) }));
// eslint-disable-next-line import/first
import { listTeams, getTeam } from '../controllers/teams.controller';

const T = '11111111-1111-4111-8111-111111111111';
const has = (q: Q, s: string) => q.some((c) => c.includes(s));
// team T: 12 rows in team_members, one of them a deleted account
const deletedRow = (q: Q) => q[0] === 'from:team_members' && has(q, 'deleted_at') && q.some((c) => c.startsWith('not:'));
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
};

beforeEach(() => {
  mockLog = [];
  mockNext = (q) => {
    if (deletedRow(q)) return { data: [{ team_id: T }] };
    if (q[0] === 'from:teams' && has(q, 'maybeSingle')) return { data: { id: T, name: 'P3 Count', is_public: true, deleted_at: null, city: null } };
    if (q[0] === 'from:teams') return { data: [{ id: T, name: 'P3 Count', city: null, members: [{ count: 12 }] }], count: 1 };
    if (q[0] === 'from:team_members' && has(q, 'head')) return { count: 12 };
    if (q[0] === 'from:team_members' && has(q, 'jersey_number')) return { data: Array.from({ length: 11 }, (_, i) => ({ id: `m${i}`, role: i ? 'player' : 'captain', user: { id: i ? `u${i}` : 'me' } })) };
    if (q[0] === 'from:team_members' && has(q, 'maybeSingle')) return { data: { id: 'm0' } };
    return { data: [], count: 0 };
  };
});

test('the Teams list card leaves out a member whose account is deleted', async () => {
  const r = res();
  await listTeams({ userId: 'me', params: {}, query: { mine: '1' }, body: {} } as never, r);
  expect(r.statusCode).toBe(200);
  expect(r.body.teams[0].member_count).toBe(11);
});

test('the team page member_count equals its member rows', async () => {
  const r = res();
  await getTeam({ userId: 'me', params: { id: T }, query: {}, body: {} } as never, r);
  expect(r.statusCode).toBe(200);
  expect(r.body.members).toHaveLength(11);
  expect(r.body.team.member_count).toBe(11);
});
