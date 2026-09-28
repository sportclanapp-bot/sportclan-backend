/**
 * Phase 4 · K1-62 (8c9e934) SC-83 — a second entry for the same team is a
 * clean 400 ALREADY_ENTERED (existing live entry, or a concurrent insert's
 * 23505), never a 500. The reopen of a withdrawn entry is pinned by
 * phase3TournamentsB08 › "a withdrawn entry is reopened, not duplicated".
 * Mocking copied from phase3TournamentsB08.
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
import { joinByCode } from '../controllers/tournaments.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const TEAM = '33333333-3333-4333-8333-333333333333';
const TB = '44444444-4444-4444-8444-444444444444';
const STRANGER = '55555555-5555-4555-8555-555555555555';
const CRICKET = 'sport-cricket';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const has = (q: Q, s: string) => q.some((c) => c.includes(s));
const join = async () => {
  const r = res();
  await joinByCode({ userId: ME, params: {}, query: {}, body: { entry_code: 'abc234', team_id: TEAM } } as any, r);
  return r;
};

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

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('SC-83 · re-entry never 500s', () => {
  it('K1-62 (8c9e934): a team already pending/approved → 400 ALREADY_ENTERED, no insert', async () => {
    mockNext = world({ existing: { status: 'pending' } });
    const r = await join();
    expect([r.statusCode, r.body.code]).toEqual([400, 'ALREADY_ENTERED']);
    expect(mockLog.some((q) => has(q, 'insert:'))).toBe(false);
  });
  it('K1-62 (8c9e934): a concurrent insert hitting the unique key (23505) → 400 ALREADY_ENTERED, not 500', async () => {
    const base = world();
    mockNext = (q) => (q[0] === 'from:tournament_entries' && has(q, 'insert:')
      ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
      : base(q));
    const r = await join();
    expect([r.statusCode, r.body.code]).toEqual([400, 'ALREADY_ENTERED']);
  });
  it('K1-62 (8c9e934): only rejected/withdrawn rows are reopened', async () => {
    mockNext = world({ existing: { status: 'approved' } });
    await join();
    const upd = mockLog.find((q) => q[0] === 'from:tournament_entries' && has(q, 'update:'))!;
    expect(upd).toContain('in:["status",["rejected","withdrawn"]]');
  });
});
