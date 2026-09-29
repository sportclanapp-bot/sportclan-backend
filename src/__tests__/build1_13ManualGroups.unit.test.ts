/**
 * BUILD 1.13 · a manual group_label survives the draw (it was overwritten by
 * the round-robin deal), and a team can't change group once the groups are
 * drawn (the table would split from its matches).
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
import { generateFixtures, updateEntry } from '../controllers/tournaments.controller';
const T = '22222222-2222-4222-8222-222222222222';
const has = (q: Q, s: string) => q.some((c) => c.startsWith(s));
const run = async (fn: any, req: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), on: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: 'me', params: { id: T }, query: {}, body: {}, ...req } as any, r);
  return r;
};
const inserted = () => mockLog.filter((q) => q[0] === 'from:matches' && has(q, 'insert:')).flatMap((q) => q.filter((c) => c.startsWith('insert:')).map((c) => JSON.parse(c.slice(7)))).flat();
const labelWrites = () => mockLog.filter((q) => q[0] === 'from:tournament_entries' && has(q, 'update:'))
  .map((q) => [JSON.parse(q.find((c) => c.startsWith('update:'))!.slice(7))[0].group_label, JSON.parse(q.filter((c) => c.startsWith('eq:')).pop()!.slice(3))[1]]);

describe('BUILD 1.13 · the draw keeps a manual group', () => {
  test('labelled teams stay in their group; the rest fill the smallest', async () => {
    mockLog = [];
    mockSportSlug = 'football';
    const entries = [['a', 'B'], ['b', 'B'], ['c', null], ['d', null], ['e', 'a']].map(([id, g]) => ({ team_id: id, group_label: g, team: { id, name: id } }));
    mockNext = (q) => {
      if (q[0] === 'from:tournaments' && has(q, 'update:')) return { data: [{ id: T }] };
      if (q[0] === 'from:tournaments') return { data: { id: T, status: 'upcoming', sport_id: 'sp', format: 'groups_knockout', start_date: '2026-10-05' } };
      if (q[0] === 'from:tournament_entries' && has(q, 'select:')) return { data: entries };
      if (q[0] === 'from:matches' && has(q, 'insert:')) return { data: [{ id: 'm1' }] };
      return { data: [] };
    };
    const r = await run(generateFixtures, {});
    expect(r.statusCode).toBe(200);
    expect(labelWrites().sort()).toEqual([['A', 'c'], ['A', 'd'], ['A', 'e'], ['B', 'a'], ['B', 'b']]);
    const groupB = inserted().filter((m) => m.group_label === 'B').map((m) => [m.team_a_id, m.team_b_id].sort().join(''));
    expect(groupB).toEqual(['ab']);
  });
});

describe('BUILD 1.13 · a team can’t change group after the draw', () => {
  const entryCall = (drawn: boolean, body: object) => {
    mockLog = [];
    mockNext = (q) => {
      if (q[0] === 'from:tournament_entries' && has(q, 'update:')) return { data: { id: 'e1' } };
      if (q[0] === 'from:tournament_entries') return { data: { id: 'e1', tournament_id: T, team_id: 'a', status: 'approved' } };
      if (q[0] === 'from:tournaments') return { data: { id: T, status: 'upcoming', fixtures_generated: drawn, created_by: 'me' } };
      return { data: null };
    };
    return run(updateEntry, { params: { id: T, entryId: 'e1' }, body });
  };
  test('drawn → 409 GROUPS_LOCKED, nothing written', async () => {
    const r = await entryCall(true, { group_label: 'B' });
    expect([r.statusCode, r.body.code]).toEqual([409, 'GROUPS_LOCKED']);
    expect(mockLog.some((q) => has(q, 'update:'))).toBe(false);
  });
  test('before the draw it is stored, in capitals', async () => {
    const r = await entryCall(false, { group_label: ' b ' });
    expect(r.statusCode).toBe(200);
    expect(mockLog.find((q) => q[0] === 'from:tournament_entries' && has(q, 'update:'))!.join()).toContain('"group_label":"B"');
  });
});
