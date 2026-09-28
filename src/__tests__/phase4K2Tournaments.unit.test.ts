/**
 * Phase 4 · K2 — regression tests for backend tournament fixes (see the app
 * repo's phase4/K2.md). Supabase is mocked like phase3TournamentsB08: every
 * `from()` starts its own query, resolved by `mockNext(q)`.
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
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
import { joinByCode, generateFixtures } from '../controllers/tournaments.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const TEAM = '33333333-3333-4333-8333-333333333333';
const TB = '44444444-4444-4444-8444-444444444444';
const STRANGER = '55555555-5555-4555-8555-555555555555';
const FIX = '66666666-6666-4666-8666-666666666666';
const NEXT = '77777777-7777-4777-8777-777777777777';
const CRICKET = 'sport-cricket';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => {
  const r = res();
  await fn({ userId: ME, params: { id: T }, query: {}, body: {}, ...req }, r);
  return r;
};
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));
const has = (q: Q, s: string) => q.some((c) => c.includes(s));

/** A tournament world: the tournament row, the entering team, entry counts, roster. */
function world(o: {
  t?: Record<string, unknown> | null;
  team?: Record<string, unknown> | null;
  count?: number;
  role?: string;
  overlap?: boolean;
  existing?: unknown;
} = {}) {
  const t = o.t === null ? null : { id: T, name: 'P3 Cup', status: 'upcoming', sport_id: CRICKET, max_teams: 4, registration_deadline: null, fixtures_generated: false, created_by: STRANGER, ...(o.t ?? {}) };
  const team = o.team === null ? null : { id: TEAM, sport_id: CRICKET, name: 'P3 XI', ...(o.team ?? {}) };
  return (q: Q) => {
    const tbl = q[0];
    if (tbl === 'from:tournaments') return { data: has(q, 'select:["id"]') && has(q, 'entry_code') ? (t ? { id: T } : null) : t };
    if (tbl === 'from:teams') return { data: team };
    if (tbl === 'from:sports') return { data: { name: 'Cricket' } };
    if (tbl === 'from:team_members') {
      if (has(q, 'select:["role"]')) return { data: { role: o.role ?? 'captain' } };
      if (has(q, '"team_id",["')) return { data: o.overlap ? { team_id: TB } : null }; // the overlap probe
      return { data: [{ user_id: ME }] };
    }
    if (tbl === 'from:tournament_entries') {
      if (has(q, '{"count":"exact","head":true}')) return { count: o.count ?? 0 };
      if (has(q, 'update:')) return { data: null };
      if (has(q, 'insert:')) return { data: { id: 'entry-1', tournament_id: T, team_id: TEAM, status: 'pending' } };
      if (has(q, 'select:["team_id"]')) return { data: o.overlap ? [{ team_id: TB }] : [] };
      return { data: o.existing ?? null };
    }
    return { data: null };
  };
}

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockCanOpenChat = false;
});

describe('K2-6e · a concurrent double join-by-code is a clean refusal (SC-119)', () => {
  it('K2-6e (cdba317): the insert losing the unique race (23505) → 400 ALREADY_ENTERED, not 500', async () => {
    const base = world();
    mockNext = (q) => (q[0] === 'from:tournament_entries' && has(q, 'insert:') ? { data: null, error: { code: '23505', message: 'duplicate key value' } } : base(q));
    const r = await call(joinByCode, { params: {}, body: { entry_code: 'abc234', team_id: TEAM } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'ALREADY_ENTERED']);
  });
});

describe('K2-14 · a crash-stuck fixture generation can recover (SC-128)', () => {
  const stuck = (o: { matches: number; recovered: boolean }) => (q: Q) => {
    if (q[0] === 'from:tournaments' && has(q, 'update:[{"fixtures_generated":true')) return { data: [] }; // claim lost: flag already true
    if (q[0] === 'from:tournaments' && has(q, 'lt:["updated_at"')) return { data: o.recovered ? [{ id: T }] : [] };
    if (q[0] === 'from:tournaments') return { data: { id: T, status: 'upcoming', sport_id: CRICKET, format: 'knockout', start_date: '2026-10-05', created_by: ME } };
    if (q[0] === 'from:matches' && has(q, '{"count":"exact","head":true}')) return { count: o.matches };
    if (q[0] === 'from:matches' && has(q, 'insert:')) return { data: [{ id: 'm1' }] };
    if (q[0] === 'from:tournament_entries') return { data: [{ team_id: TEAM, team: { name: 'A' } }, { team_id: TB, team: { name: 'B' } }] };
    return { data: null };
  };
  const fixtureInserts = () => mockLog.filter((q) => q[0] === 'from:matches' && has(q, 'insert:'));
  it('K2-14 (b633dcd): flag stuck true, 0 matches, stale timestamp → regenerates instead of 409 forever', async () => {
    mockNext = stuck({ matches: 0, recovered: true });
    const r = await call(generateFixtures, {});
    expect(r.statusCode).not.toBe(409);
    expect(fixtureInserts().length).toBeGreaterThan(0);
  });
  it('K2-14 (b633dcd): a real bracket (matches exist) → 409, nothing inserted', async () => {
    mockNext = stuck({ matches: 3, recovered: true });
    const r = await call(generateFixtures, {});
    expect(r.statusCode).toBe(409);
    expect(fixtureInserts()).toHaveLength(0);
  });
  it('K2-14 (b633dcd): 0 matches but a FRESH timestamp (generation in progress) → 409, nothing inserted', async () => {
    mockNext = stuck({ matches: 0, recovered: false });
    const r = await call(generateFixtures, {});
    expect(r.statusCode).toBe(409);
    expect(fixtureInserts()).toHaveLength(0);
  });
});

describe('K2-37b · a league is a double round-robin (SC-221)', () => {
  const TC = '88888888-8888-4888-8888-888888888888';
  const gen = (format: string) => (q: Q) => {
    if (q[0] === 'from:tournaments' && has(q, 'update:')) return { data: [{ id: T }] };
    if (q[0] === 'from:tournaments') return { data: { id: T, status: 'upcoming', sport_id: CRICKET, format, start_date: '2026-10-05', created_by: ME } };
    if (q[0] === 'from:tournament_entries') return { data: [{ team_id: TEAM, team: { name: 'A' } }, { team_id: TB, team: { name: 'B' } }, { team_id: TC, team: { name: 'C' } }] };
    if (q[0] === 'from:matches' && has(q, 'insert:')) return { data: [] };
    return { data: null };
  };
  const pairs = () => mockLog.filter((q) => q[0] === 'from:matches' && has(q, 'insert:'))
    .flatMap((q) => JSON.parse(q.find((c) => c.startsWith('insert:'))!.slice(7)))
    .map((m: any) => `${m.team_a_id.slice(0, 1)}-${m.team_b_id.slice(0, 1)}`).sort();
  it('K2-37b (6dcd12a): 3 teams in a league → 6 fixtures, every pair home and away', async () => {
    mockNext = gen('league');
    await call(generateFixtures, {});
    expect(pairs()).toEqual(['3-4', '3-8', '4-3', '4-8', '8-3', '8-4']);
  });
  it('K2-37b (6dcd12a): a round robin stays single-leg (3 fixtures)', async () => {
    mockNext = gen('round_robin');
    await call(generateFixtures, {});
    expect(pairs()).toHaveLength(3);
  });
});
