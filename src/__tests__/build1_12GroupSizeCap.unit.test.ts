/**
 * BUILD 1.12 · `group_size` is a cap. It only chose the group count when no
 * count was set, and was ignored otherwise — 2 groups with a size of 4 took
 * 12 teams as two groups of 6. No group is drawn bigger than the size now,
 * and when the teams can't fit (or can't make groups of 2) the draw is
 * refused before it's claimed.
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
import { generateFixtures, createTournament } from '../controllers/tournaments.controller';
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

const groupSizes = () => {
  const rows = inserted().flat().filter((row) => row.group_label);
  const pairs = new Map<string, number>();
  for (const r of rows) pairs.set(r.group_label, (pairs.get(r.group_label) ?? 0) + 1);
  // n teams play n(n-1)/2 group matches: recover n from the count.
  return [...pairs.entries()].sort().map(([, m]) => (1 + Math.sqrt(1 + 8 * m)) / 2);
};

describe('BUILD 1.12 · group size is a cap', () => {
  test('12 teams, 2 groups, size 4 → 400 GROUPS_TOO_SMALL (groups of 6), not claimed', async () => {
    setup(12, { num_groups: 2, group_size: 4 });
    const r = await call();
    expect([r.statusCode, r.body.code]).toEqual([400, 'GROUPS_TOO_SMALL']);
    expect(r.body.error).toBe('12 teams in 2 groups makes groups of 6, more than the group size of 4.');
    expect(claimed()).toBe(false);
  });
  test('8 teams, 2 groups, size 4 → two groups of 4', async () => {
    setup(8, { num_groups: 2, group_size: 4 });
    expect((await call()).statusCode).toBe(200);
    expect(groupSizes()).toEqual([4, 4]);
  });
  test('size 3 alone: 7 teams → 3 groups (3, 2, 2), none above 3', async () => {
    setup(7, { group_size: 3 });
    expect((await call()).statusCode).toBe(200);
    expect(groupSizes()).toEqual([3, 2, 2]);
  });
  test('5 teams in groups of at most 2 can’t be drawn → 400', async () => {
    setup(5, { group_size: 2 });
    const r = await call();
    expect([r.statusCode, r.body.code]).toEqual([400, 'GROUPS_TOO_SMALL']);
  });
  test('create: max teams above groups × size → 400, nothing inserted', async () => {
    mockLog = [];
    mockNext = () => ({ data: null });
    const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
    r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
    r.json = jest.fn((b: unknown) => { r.body = b; return r; });
    await createTournament({ userId: 'me', params: {}, query: {}, body: {
      sport_id: 'sp', name: 'P3 Cap', format: 'groups_knockout', max_teams: 12, entry_fee: 0, start_date: '2026-10-05', num_groups: 2, group_size: 4,
    } } as any, r);
    expect([r.statusCode, r.body.code, r.body.error]).toEqual([400, 'GROUPS_TOO_SMALL', 'Max teams (12) is more than 2 groups of 4 can hold (8).']);
    expect(mockLog.some((q) => q.some((c) => c.startsWith('insert:')))).toBe(false);
  });
});
