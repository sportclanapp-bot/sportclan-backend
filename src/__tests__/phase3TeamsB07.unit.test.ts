/**
 * Phase 3 · B07 Teams (28 Sep 2026) — the backend fixes. See the app repo's
 * phase3/B07.md for each finding. Supabase is mocked: every `from()` starts its
 * own query, and each resolves to `mockNext(q)`, where `q` lists that query's
 * builder calls. `mockLog` keeps every query in order.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'lt', 'upsert']) {
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
let mockBlocked = new Set<string>();
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => mockBlocked) }));
let mockRole: string | null = 'captain';
jest.mock('../utils/teamAuth', () => ({
  isTeamManager: jest.fn(async () => mockRole === 'captain' || mockRole === 'vice_captain'),
  isTeamCaptain: jest.fn(async () => mockRole === 'captain'),
  getTeamRole: jest.fn(async () => mockRole),
}));
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatsForTeam: jest.fn(), syncAfterSuccess: jest.fn() }));
jest.mock('../utils/notify', () => ({ notifyUnlessBlocked: jest.fn(), notifyUsers: jest.fn() }));
jest.mock('../utils/sports', () => ({ validateSportForCreate: jest.fn(async () => null) }));

// eslint-disable-next-line import/first
import { createTeam, updateTeam, listTeams, joinTeamByCode, addTeamMember, removeTeamMember, getTeam, cleanTeamName } from '../controllers/teams.controller';
// eslint-disable-next-line import/first
import { addExpense, updateExpense } from '../controllers/teamExpenses.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const D = '33333333-3333-4333-8333-333333333333';
const STRANGER = '44444444-4444-4444-8444-444444444444';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, ...req }, r); return r; };
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockBlocked = new Set();
  mockRole = 'captain';
});

describe('F13 · a team name is a trimmed, non-empty string', () => {
  test.each(['', '   ', 123, null])('%j → 400 "Give the team a name."', async (name) => {
    expect(cleanTeamName(name).error).toBe('Give the team a name.');
    const r = await call(updateTeam, { params: { id: TEAM }, body: { name } });
    expect(r.statusCode).toBe(400);
    expect(writes()).toHaveLength(0);
  });
  test('"  Pune XI  " is stored trimmed, on create and on update', async () => {
    mockNext = (q) => (q[0] === 'from:teams' && q.some((c) => c.startsWith('insert:')) ? { data: { id: TEAM } } : { data: null });
    await call(createTeam, { body: { sport_id: 'cricket', name: '  Pune XI  ' } });
    expect(mockLog.find((q) => q.some((c) => c.startsWith('insert:{"sport_id"')))!.join()).toContain('"name":"Pune XI"');
    mockLog = [];
    mockNext = () => ({ data: { id: TEAM } });
    await call(updateTeam, { params: { id: TEAM }, body: { name: '  Pune XI  ' } });
    expect(mockLog.find((q) => q[0] === 'from:teams')!.join()).toContain('"name":"Pune XI"');
  });
});

describe('F11 · malformed input is a worded 400, not a 500', () => {
  test('create / update with city_id "abc"', async () => {
    const c = await call(createTeam, { body: { sport_id: 'cricket', name: 'P3', city_id: 'abc' } });
    expect([c.statusCode, c.body.error]).toEqual([400, 'Pick a city from the list.']);
    const u = await call(updateTeam, { params: { id: TEAM }, body: { city_id: 'abc' } });
    expect(u.statusCode).toBe(400);
    expect(writes()).toHaveLength(0);
  });
  test('list: city_id "abc" → 400; a repeated sport_id takes the first value', async () => {
    expect((await call(listTeams, { query: { city_id: 'abc' } })).statusCode).toBe(400);
    const r = await call(listTeams, { query: { sport_id: ['a', 'b'] } });
    expect(r.statusCode).not.toBe(500);
  });
  test.each([123456, ['A'], '  '])('join code %j → 400', async (join_code) => {
    const r = await call(joinTeamByCode, { body: { join_code } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'join_code is required']);
  });
  test.each(['abc', -1, 1.5])('jersey_number %j → 400', async (jersey_number) => {
    const r = await call(addTeamMember, { params: { id: TEAM }, body: { user_id: D, jersey_number } });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('Jersey number must be a whole number, 0 or more.');
    expect(writes()).toHaveLength(0);
  });
  test.each([0, 1000])('jersey_number %j passes the number check (Stage 13 · CR3: no top)', async (jersey_number) => {
    const r = await call(addTeamMember, { params: { id: TEAM }, body: { user_id: D, jersey_number } });
    expect(r.body?.error).not.toBe('Jersey number must be a whole number, 0 or more.');
  });
  test('expense match_id "abc" → 400 "Invalid match."', async () => {
    mockNext = (q) => (q[0] === 'from:team_bans' ? { data: null } : { data: { id: 'm' } }); // a member, no ban
    const r = await call(addExpense, { params: { id: TEAM }, body: { title: 'Ground', amount: 100, match_id: 'abc' } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'Invalid match.']);
  });
});

describe('F3b · a captain can\'t add someone blocked with a member', () => {
  test('block either way → 403 BLOCKED_FROM_TEAM, nothing inserted, no names', async () => {
    mockBlocked = new Set([ME]);
    mockNext = (q) => (q[0] === 'from:users' ? { data: { id: D } } : q[0] === 'from:team_members' ? { data: [{ user_id: ME }], count: 2 } : { data: null });
    const r = await call(addTeamMember, { params: { id: TEAM }, body: { user_id: D } });
    expect(r.statusCode).toBe(403);
    expect(r.body).toEqual({ error: 'You can’t add this person.', code: 'BLOCKED_FROM_TEAM' });
    expect(writes()).toHaveLength(0);
  });
});

describe('F9b / F12 · expense split and notes', () => {
  const member = (q: Q) => (q[0] === 'from:team_members' && q.some((c) => c.includes('"user_id",' + JSON.stringify(ME))) ? { data: { id: 'm' } } : null);
  beforeEach(() => {
    mockNext = (q) => member(q)
      ?? (q[0] === 'from:team_members' ? { data: [{ user_id: ME }, { user_id: D }] }
        : q[0] === 'from:team_expenses' && q.some((c) => c.startsWith('eq:["id"')) ? { data: { id: STRANGER, team_id: TEAM, created_by: ME, split_among: [ME] } }
          : { data: null });
  });
  test.each([[[STRANGER]], [['abc']], ['not-a-list']])('split %j → 400, nothing inserted', async (split_among) => {
    const r = await call(addExpense, { params: { id: TEAM }, body: { title: 'Ground', amount: 100, split_among } });
    expect(r.statusCode).toBe(400);
    expect(writes()).toHaveLength(0);
  });
  test('members only, de-duplicated → stored', async () => {
    await call(addExpense, { params: { id: TEAM }, body: { title: 'Ground', amount: 100, split_among: [ME, D, D] } });
    const ins = mockLog.find((q) => q[0] === 'from:team_expenses' && q.some((c) => c.startsWith('insert:')))!;
    expect(ins.join()).toContain(`"split_among":["${ME}","${D}"]`);
  });
  test.each([[{ x: 1 }], ['x'.repeat(281)]])('notes %j → 400', async (notes) => {
    const r = await call(addExpense, { params: { id: TEAM }, body: { title: 'Ground', amount: 100, notes } });
    expect(r.statusCode).toBe(400);
    const u = await call(updateExpense, { params: { id: TEAM, expenseId: STRANGER }, body: { notes } });
    expect(u.statusCode).toBe(400);
  });
});

describe('F22 · removing a non-member is a 404, not "removed, banned"', () => {
  test('the delete touched no row → 404, no ban written', async () => {
    mockNext = () => ({ data: [] });
    const r = await call(removeTeamMember, { params: { id: TEAM, userId: STRANGER } });
    expect([r.statusCode, r.body.error]).toEqual([404, 'Not a member of this team.']);
    expect(mockLog.some((q) => q[0] === 'from:team_bans')).toBe(false);
  });
  test('a member removed → removed and banned', async () => {
    mockNext = () => ({ data: [{ id: 'row' }] });
    const r = await call(removeTeamMember, { params: { id: TEAM, userId: D } });
    expect(r.body).toEqual({ removed: true, banned: true });
  });
});

describe('F6 · the team page says when the viewer\'s request is pending', () => {
  test('non-member with a pending row → my_request "pending"', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:teams') return { data: { id: TEAM, name: 'P3', is_public: true } };
      if (q[0] === 'from:team_join_requests') return { data: { status: 'pending' } };
      if (q[0] === 'from:team_members' && q.some((c) => c.startsWith('select:["id, role'))) return { data: [] };
      return { data: null, count: 0 };
    };
    const r = await call(getTeam, { params: { id: TEAM } });
    expect(r.body.team.my_request).toBe('pending');
  });
});
