/**
 * Phase 4 · K2 — regression tests for the backend team fixes (see the app repo's
 * phase4/K2.md). Supabase is mocked: every `from()` starts its own query, which
 * resolves to `mockNext(q)`, where `q` lists that query's builder calls.
 */
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
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async (n: string, a: unknown) => { mockLog.push([`rpc:${n}`, JSON.stringify(a)]); return { data: null, error: null }; }) } };
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
jest.mock('../utils/notify', () => ({ notifyUnlessBlocked: jest.fn(), notifyUsers: jest.fn(), notifyUser: jest.fn() }));
jest.mock('../utils/sports', () => ({ validateSportForCreate: jest.fn(async () => null) }));
jest.mock('../utils/teamRecord', () => ({ computeTeamRecord: jest.fn(async () => ({ played: 0, won: 0, lost: 0 })) }));

// eslint-disable-next-line import/first
import { joinTeamByCode, addTeamMember, getTeam, removeTeamMember } from '../controllers/teams.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const D = '33333333-3333-4333-8333-333333333333';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), on: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, ...req }, r); return r; };
const inserts = (t: string) => mockLog.filter((q) => q[0] === `from:${t}` && q.some((c) => c.startsWith('insert:')));

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockBlocked = new Set();
  mockRole = 'captain';
});

describe('K2-1 · join-by-code honours blocks', () => {
  const world = (q: Q) => {
    if (q[0] === 'from:teams') return { data: { id: TEAM, name: 'P4 XI', join_policy: 'open', deleted_at: null } };
    if (q[0] === 'from:team_members' && q.some((c) => c.startsWith('insert:'))) return { data: { id: 'm1' } };
    if (q[0] === 'from:team_members' && q.some((c) => c === `eq:["user_id","${ME}"]`)) return { data: null }; // not yet a member
    if (q[0] === 'from:team_members') return { data: [{ user_id: D }], count: 1 };
    return { data: null };
  };
  it('K2-1 (f08fedd): a joiner blocked with any current member gets 403 BLOCKED_FROM_TEAM and is not inserted', async () => {
    mockBlocked = new Set([D]);
    mockNext = world;
    const r = await call(joinTeamByCode, { body: { join_code: 'abc123' } });
    expect(r.statusCode).toBe(403);
    expect(r.body.code).toBe('BLOCKED_FROM_TEAM');
    expect(inserts('team_members')).toHaveLength(0);
  });
  it('K2-1 (f08fedd): with no block the same join goes through', async () => {
    mockNext = world;
    const r = await call(joinTeamByCode, { body: { join_code: 'abc123' } });
    expect(r.statusCode).toBe(200);
    expect(inserts('team_members')).toHaveLength(1);
  });
});

describe('K2-2e · addTeamMember only assigns player / vice_captain (SC-103)', () => {
  it.each(['captain', 'owner', ''])('K2-2e (99ffb16): role %j → 400, nothing inserted', async (role) => {
    mockNext = (q) => (q[0] === 'from:users' ? { data: { id: D } } : { data: null, count: 1 });
    const r = await call(addTeamMember, { params: { id: TEAM }, body: { user_id: D, role } });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe("role must be 'player' or 'vice_captain'");
    expect(inserts('team_members')).toHaveLength(0);
  });
});

describe('K2-6d · addTeamMember maps a concurrent duplicate to 409 (SC-119)', () => {
  it('K2-6d (cdba317): unique violation 23505 → 409 ALREADY_MEMBER, not 500', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:users') return { data: { id: D } };
      if (q[0] === 'from:team_members' && q.some((c) => c.startsWith('insert:'))) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      return { data: null, count: 1 };
    };
    const r = await call(addTeamMember, { params: { id: TEAM }, body: { user_id: D } });
    expect(r.statusCode).toBe(409);
    expect(r.body.code).toBe('ALREADY_MEMBER');
  });
});

describe('K2-2i · a private team is readable by members only (SC-107)', () => {
  const team = (isPublic: boolean, member: boolean) => (q: Q) => {
    if (q[0] === 'from:teams') return { data: { id: TEAM, name: 'Hidden XI', is_public: isPublic, deleted_at: null, city: null } };
    if (q[0] === 'from:team_members' && q.some((c) => c === `eq:["user_id","${ME}"]`)) return { data: member ? { id: 'm' } : null };
    if (q[0] === 'from:team_members') return { data: [], count: 0 };
    return { data: null, count: 0 };
  };
  it('K2-2i (99ffb16): a non-member reading a private team → 403 "This team is private"', async () => {
    mockNext = team(false, false);
    const r = await call(getTeam, { params: { id: TEAM } });
    expect(r.statusCode).toBe(403);
    expect(r.body).toEqual({ error: 'This team is private' });
  });
  it('K2-2i (99ffb16): a member reads it', async () => {
    mockNext = team(false, true);
    const r = await call(getTeam, { params: { id: TEAM } });
    expect(r.statusCode).toBe(200);
  });
});

describe('K2-49a · a captain leaving hands the team on first (SC-243)', () => {
  const E = '55555555-5555-4555-8555-555555555555';
  it('K2-49a (ba1d194): captaincy moves to the heir BEFORE the ex-captain’s row is deleted', async () => {
    mockNext = (q) => (q[0] === 'from:team_members' && q.some((c) => c.startsWith('neq:'))
      ? { data: [{ user_id: E, role: 'player', joined_at: '2026-01-01' }, { user_id: D, role: 'vice_captain', joined_at: '2026-02-01' }] }
      : { data: null });
    const r = await call(removeTeamMember, { params: { id: TEAM, userId: ME } });
    expect(r.body).toEqual({ removed: true, captaincy_transferred_to: D }); // the co-captain is preferred
    const rpcAt = mockLog.findIndex((q) => q[0] === 'rpc:transfer_team_captaincy');
    const delAt = mockLog.findIndex((q) => q[0] === 'from:team_members' && q.some((c) => c.startsWith('delete:')));
    expect(rpcAt).toBeGreaterThan(-1);
    expect(JSON.parse(mockLog[rpcAt][1])).toEqual({ p_team_id: TEAM, p_actor_id: ME, p_target_id: D });
    expect(delAt).toBeGreaterThan(rpcAt);
  });
});

describe('K2-49b · malformed ids are a 400, a missing user a 404 — never a 500 (SC-244)', () => {
  it('K2-49b (ba1d194): addTeamMember user_id "abc" → 400; a well-formed unknown user → 404, nothing inserted', async () => {
    expect((await call(addTeamMember, { params: { id: TEAM }, body: { user_id: 'abc' } })).body).toEqual({ error: 'Invalid user_id' });
    const r = await call(addTeamMember, { params: { id: TEAM }, body: { user_id: D } });
    expect([r.statusCode, r.body.error]).toEqual([404, 'User not found']);
    expect(inserts('team_members')).toHaveLength(0);
  });
  it.each([
    ['getTeam', getTeam, { params: { id: 'abc' } }],
    ['removeTeamMember (team)', removeTeamMember, { params: { id: 'abc', userId: ME } }],
    ['removeTeamMember (user)', removeTeamMember, { params: { id: TEAM, userId: 'abc' } }],
    ['addTeamMember (team)', addTeamMember, { params: { id: 'abc' }, body: { user_id: D } }],
  ])('K2-49b (ba1d194): %s with a non-uuid → 400, no query', async (_n, fn, req) => {
    const r = await call(fn, req);
    expect(r.statusCode).toBe(400);
    expect(mockLog.filter((q) => q[0].startsWith('from:'))).toHaveLength(0);
  });
});

describe('K2-65a · the team header gets its W/L/D record (SC-293/290)', () => {
  it('K2-65a (340ef3d): getTeam returns record from computeTeamRecord', async () => {
    const { computeTeamRecord } = jest.requireMock('../utils/teamRecord');
    (computeTeamRecord as jest.Mock).mockResolvedValueOnce({ played: 3, wins: 2, losses: 1, draws: 0, win_rate: 67 });
    mockNext = (q) => (q[0] === 'from:teams' ? { data: { id: TEAM, name: 'P4 XI', is_public: true, deleted_at: null } } : { data: [], count: 0 });
    const r = await call(getTeam, { params: { id: TEAM } });
    expect(r.body.team.record).toEqual({ played: 3, wins: 2, losses: 1, draws: 0, win_rate: 67 });
  });
  it('K2-65a (340ef3d): computeTeamRecord counts wins / losses / draws by winner_team_id', async () => {
    const { computeTeamRecord } = jest.requireActual('../utils/teamRecord');
    mockNext = () => ({ data: [{ winner_team_id: TEAM }, { winner_team_id: TEAM }, { winner_team_id: D }, { winner_team_id: null }] });
    expect(await computeTeamRecord(TEAM)).toEqual({ played: 4, wins: 2, losses: 1, draws: 1, win_rate: 50 });
  });
});
