/**
 * BUILD 1.10 · the groups → knockout draw refuses a group of one (it has no
 * matches, so the knockout never seeds and the tournament never finishes),
 * with the same rule the app gates Generate on (utils/groupsPlan). Two or
 * three teams with the default grouping still draw: one group, then a final.
 */
let mockSportSlug = 'cricket';
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'upsert']) {
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
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  isTournamentOrganiser: jest.fn(async () => true),
  logAdminAction: jest.fn(),
}));
jest.mock('../utils/teamVisibility', () => ({ ...jest.requireActual('../utils/teamVisibility'), isTeamDisbanded: jest.fn(async () => false) }));
let mockCanOpenChat = false;
jest.mock('../utils/tournamentChat', () => ({
  syncTournamentChatMembers: jest.fn(async () => undefined),
  syncAfterSuccess: jest.fn(),
  canOpenTournamentChat: jest.fn(async () => mockCanOpenChat),
}));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), validateSportForCreate: jest.fn(async () => null) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => undefined) }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: mockSportSlug })) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
import { generateFixtures } from '../controllers/tournaments.controller';
const T = '22222222-2222-4222-8222-222222222222';
const has = (q: Q, s: string) => q.some((c) => c.startsWith(s));
const call = async () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await generateFixtures({ userId: 'me', params: { id: T }, query: {}, body: {} } as any, r);
  return r;
};
const inserted = () => mockLog.filter((q) => q[0] === 'from:matches' && has(q, 'insert:')).flatMap((q) => q.filter((c) => c.startsWith('insert:')).map((c) => JSON.parse(c.slice(7))));
const setup = (teams: number, cfg: object = {}) => {
  mockLog = [];
  mockSportSlug = 'football';
  mockNext = (q) => {
    if (q[0] === 'from:tournaments' && has(q, 'update:')) return { data: [{ id: T }] };
    if (q[0] === 'from:tournaments') return { data: { id: T, status: 'upcoming', sport_id: 'sp', format: 'groups_knockout', start_date: '2026-10-05', ...cfg } };
    if (q[0] === 'from:tournament_entries') return { data: Array.from({ length: teams }, (_, i) => ({ team_id: `t${i}`, team: { id: `t${i}`, name: `T${i}` } })) };
    if (q[0] === 'from:matches' && has(q, 'insert:')) return { data: [{ id: 'm1' }] };
    return { data: [] };
  };
};
const claimed = () => mockLog.some((q) => q[0] === 'from:tournaments' && has(q, 'update:'));

describe('BUILD 1.10 · groups → knockout minimum', () => {
  test.each([2, 3, 4])('%i teams, default grouping → drawn (one group, then a final)', async (n) => {
    setup(n);
    const r = await call();
    expect(r.statusCode).toBe(200);
    expect(inserted().flat().filter((row) => row.group_label === 'A').length).toBe((n * (n - 1)) / 2);
  });
  test.each([[2, 2], [3, 2]])('%i teams in %i groups → 400 GROUPS_TOO_SMALL, the draw is not claimed', async (n, g) => {
    setup(n, { num_groups: g });
    const r = await call();
    expect([r.statusCode, r.body.code]).toEqual([400, 'GROUPS_TOO_SMALL']);
    expect(r.body.error).toMatch(/Each group needs at least 2 teams/);
    expect(claimed()).toBe(false);
    expect(inserted()).toHaveLength(0);
  });
  test('5 teams in groups of 2 → 3 + 2, not 2 + 2 + 1', async () => {
    setup(5, { group_size: 2 });
    expect((await call()).statusCode).toBe(200);
    const rows = inserted().flat().filter((row) => row.group_label);
    expect(rows.filter((r) => r.group_label === 'A')).toHaveLength(3);
    expect(rows.filter((r) => r.group_label === 'B')).toHaveLength(1);
    expect(rows.filter((r) => r.group_label === 'C')).toHaveLength(0);
  });
  test('4 teams in 2 groups → drawn', async () => {
    setup(4, { num_groups: 2 });
    expect((await call()).statusCode).toBe(200);
  });
});
