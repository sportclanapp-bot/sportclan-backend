/**
 * Phase 4 · K1 (backend fix commits) — terminal matches stay frozen.
 * Harness copied from phase3MatchesB05: every `from()` is its own recorded query
 * resolving to `mockNext(q)`.
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
let mockBlocked = new Set<string>();
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => mockBlocked) }));
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  canOfficiateMatch: jest.fn(async () => true),
  isTournamentOrganiser: jest.fn(async () => true),
}));
jest.mock('../utils/scoringLease', () => ({
  ...jest.requireActual('../utils/scoringLease'),
  checkLease: jest.fn(async () => ({ ok: true })),
  claimLease: jest.fn(async () => ({ taken: true, lease: null })),
  takeOverLease: jest.fn(async () => ({ ok: true, lease: null })),
}));
let mockPending = false;
jest.mock('../utils/singles', () => ({
  ...jest.requireActual('../utils/singles'),
  pendingRankedOpponent: jest.fn(async () => ({ pending: mockPending, opponentName: 'QA Device B' })),
}));
jest.mock('../utils/sportCache', () => ({
  ...jest.requireActual('../utils/sportCache'),
  getSport: jest.fn(async () => ({ slug: 'cricket' })),
}));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s?: string) => (s === 'cricket' ? 'sport-cricket' : undefined)) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
import { cancelMatch, updateMatch } from '../controllers/matches.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const MATCH = '22222222-2222-4222-8222-222222222222';
const TA = '33333333-3333-4333-8333-333333333333';
const TB = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => {
  const r = res();
  await fn({ userId: ME, params: { id: MATCH }, query: {}, body: {}, headers: { 'x-device-id': 'dev-1' }, get: () => 'dev-1', header: () => 'dev-1', ...req }, r);
  return r;
};
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));
const matchRow = (extra: object = {}) => ({
  id: MATCH, created_by: ME, umpire_id: null, status: 'scheduled', team_a_id: TA, team_b_id: TB,
  sport_id: 'sport-cricket', is_open: false, format: 'T20', overs: 20, team_a_name: 'A', team_b_name: 'B', ...extra,
});
const onMatch = (m: object) => (q: Q) => (q[0] === 'from:matches' ? { data: m } : { data: null });

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); mockBlocked = new Set(); mockPending = false; });

describe('SC-84 · a finished match cannot be cancelled', () => {
  test.each(['completed', 'abandoned'])('K1-68a (b513648): cancel on a %s match → 409, nothing written', async (status) => {
    mockNext = onMatch(matchRow({ status }));
    const r = await call(cancelMatch, {});
    expect(r.statusCode).toBe(409);
    expect(r.body.error).toBe('This match is already finished and cannot be cancelled.');
    expect(writes()).toHaveLength(0);
  });
  test('K1-68a (b513648): control — a scheduled match still cancels', async () => {
    mockNext = onMatch(matchRow({ status: 'scheduled' }));
    const r = await call(cancelMatch, {});
    expect(r.statusCode).toBe(200);
    expect(writes()[0].join()).toContain('"status":"cancelled"');
  });
});

describe('SC-85 · a finished match’s status and teams are locked', () => {
  test('K1-68b (b513648): PATCH status on a completed match → 409, nothing written', async () => {
    mockNext = onMatch(matchRow({ status: 'completed' }));
    const r = await call(updateMatch, { body: { status: 'cancelled' } });
    expect(r.statusCode).toBe(409);
    expect(r.body.error).toBe('This match is already finished — its result and status are locked.');
    expect(writes()).toHaveLength(0);
  });
  test('K1-68b (b513648): a benign field (venue) on a completed match is still editable', async () => {
    mockNext = (q) => (q[0] === 'from:matches' ? { data: matchRow({ status: 'completed' }) } : { data: null });
    const r = await call(updateMatch, { body: { venue: 'Deccan Gymkhana' } });
    expect(r.statusCode).not.toBe(409);
  });
});
