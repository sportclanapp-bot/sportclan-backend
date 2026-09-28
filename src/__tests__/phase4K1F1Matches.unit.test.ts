/**
 * Phase 4 · K1 (rows K1-35b, K1-38c, K1-40a/b) — match lifecycle:
 * stale live matches are swept to abandoned; complete checks authority before
 * status; a finished match is frozen; a never-played match can't be completed.
 * Harness copied from phase3MatchesB05: every from() is its own query and
 * resolves to mockNext(q).
 */
import fs from 'fs';
import path from 'path';

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
let mockCanOfficiate = true;
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  canOfficiateMatch: jest.fn(async () => mockCanOfficiate),
  isTournamentOrganiser: jest.fn(async () => true),
}));
jest.mock('../utils/scoringLease', () => ({
  ...jest.requireActual('../utils/scoringLease'),
  checkLease: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../utils/singles', () => ({
  ...jest.requireActual('../utils/singles'),
  pendingRankedOpponent: jest.fn(async () => ({ pending: false, opponentName: null })),
}));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'cricket' })) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
import { completeMatch, setMatchTossHandler, sweepStaleLiveMatches, joinOpenMatch } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { supabase } from '../utils/supabase';
// eslint-disable-next-line import/first
import { applyDLS, upsertInningsStats } from '../controllers/matchFeatures.controller';
// eslint-disable-next-line import/first
import { isTerminalMatchStatus } from '../utils/validation';

const ME = '11111111-1111-4111-8111-111111111111';
const MATCH = '22222222-2222-4222-8222-222222222222';
const TA = '33333333-3333-4333-8333-333333333333';
const TB = '44444444-4444-4444-8444-444444444444';
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
  id: MATCH, created_by: 'someone-else', umpire_id: null, status: 'scheduled', team_a_id: TA, team_b_id: TB,
  sport_id: 'sport-cricket', format: 'T20', overs: 20, team_a_name: 'A', team_b_name: 'B', voided_at: null, ...extra,
});
const onMatch = (m: object, events = 0) => (q: Q) => (q[0] === 'from:matches' ? { data: m }
  : q[0] === 'from:match_events' ? { data: [], count: events } : { data: null });

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); mockCanOfficiate = true; });

describe('K1-35b (8b7784b) · SC-16 stale live matches are abandoned', () => {
  it('K1-35b (8b7784b): live with no activity for 6h → bulk-marked abandoned', async () => {
    mockNext = (q) => (q.some((c) => c.startsWith('select:')) ? { data: [{ id: 'm1' }, { id: 'm2' }] } : { data: null });
    const before = Date.now();
    const out = await sweepStaleLiveMatches();
    expect(out).toEqual({ abandoned: 2 });
    const read = mockLog[0].join(' ');
    expect(read).toContain('eq:["status","live"]');
    const cutoff = JSON.parse(mockLog[0].find((c) => c.startsWith('lt:'))!.slice(3))[1];
    expect(before - Date.parse(cutoff)).toBeGreaterThanOrEqual(6 * 3600_000 - 1000);
    expect(before - Date.parse(cutoff)).toBeLessThan(6 * 3600_000 + 5000);
    const upd = writes()[0].join(' ');
    expect(upd).toContain('"status":"abandoned"');
    expect(upd).toContain('in:["id",["m1","m2"]]');
  });
  it('K1-35b (8b7784b): nothing stale → nothing written', async () => {
    mockNext = () => ({ data: [] });
    expect(await sweepStaleLiveMatches()).toEqual({ abandoned: 0 });
    expect(writes()).toHaveLength(0);
  });
  it('K1-35b (8b7784b): the hourly sweep actually calls it', () => {
    const idx = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(idx).toMatch(/await sweepStaleLiveMatches\(\)/);
  });
});

describe('K1-38c (5bb2119) · SC-33 complete: authority before status', () => {
  it('K1-38c (5bb2119): a non-officiant completing an already-completed match gets 403, not the 400 that leaks its state', async () => {
    mockCanOfficiate = false;
    mockNext = onMatch(matchRow({ status: 'completed' }));
    const r = await call(completeMatch, { body: { winner_team_id: TA } });
    expect(r.statusCode).toBe(403);
    expect(writes()).toHaveLength(0);
  });
});

describe('K1-40b (41618ad) · SC-42 completing a terminal or unplayed match', () => {
  it('K1-40b (41618ad): an abandoned match can\'t be completed → 409', async () => {
    mockNext = onMatch(matchRow({ status: 'abandoned' }));
    const r = await call(completeMatch, { body: { winner_team_id: TA } });
    expect(r.statusCode).toBe(409);
    expect(r.body.error).toBe('This match is already finished');
    expect(writes()).toHaveLength(0);
  });
  it('K1-40b (41618ad): a scheduled match with no events and no result → 400', async () => {
    mockNext = onMatch(matchRow({ status: 'scheduled' }), 0);
    const r = await call(completeMatch, { body: {} });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('Cannot complete a match that has not started');
    expect(writes()).toHaveLength(0);
  });
});

describe('K1-40a (41618ad) · SC-42 a finished match is frozen', () => {
  it('K1-40a (41618ad): terminal statuses', () => {
    for (const s of ['completed', 'abandoned', 'cancelled']) expect(isTerminalMatchStatus(s)).toBe(true);
    for (const s of ['scheduled', 'live', null, undefined]) expect(isTerminalMatchStatus(s as any)).toBe(false);
  });
  it.each(['completed', 'abandoned', 'cancelled'])('K1-40a (41618ad): toss on a %s match → 409, nothing written', async (status) => {
    mockNext = onMatch(matchRow({ status, created_by: ME }));
    const r = await call(setMatchTossHandler, { body: { tossChoice: 'bat', tossWinnerSide: 'A' } });
    expect(r.statusCode).toBe(409);
    expect(writes()).toHaveLength(0);
  });
  it('K1-40a (41618ad): DLS on a completed match → 409 MATCH_FINISHED, nothing written', async () => {
    mockNext = onMatch(matchRow({ status: 'completed', created_by: ME }));
    const r = await call(applyDLS, { body: { team1_score: 150, total_overs: 20, team2_overs_remaining: 5, team2_wickets: 3 } });
    expect([r.statusCode, r.body.code]).toEqual([409, 'MATCH_FINISHED']);
    expect(writes()).toHaveLength(0);
  });
  it('K1-40a (41618ad): innings stats on a completed match → 409, nothing written', async () => {
    mockNext = onMatch(matchRow({ status: 'completed', created_by: ME }));
    const r = await call(upsertInningsStats, { body: { stats: [{ user_id: ME, team_side: 'A', runs: 10 }] } });
    expect(r.statusCode).toBe(409);
    expect(writes()).toHaveLength(0);
  });
  it('K1-40a (41618ad): DLS by someone who may not officiate → 403 (the gate added the missing auth)', async () => {
    mockCanOfficiate = false;
    mockNext = onMatch(matchRow({ status: 'live' }));
    const r = await call(applyDLS, { body: { team1_score: 150, total_overs: 20, team2_overs_remaining: 5, team2_wickets: 3 } });
    expect(r.statusCode).toBe(403);
    expect(writes()).toHaveLength(0);
  });
});

describe('K1-50a (34c2985) · SC-59 joining an open match goes through the atomic RPC', () => {
  const rpc = supabase.rpc as unknown as jest.Mock;
  it.each([
    ['joined', 200, undefined],
    ['already_joined', 200, undefined],
    ['full', 409, 'MATCH_FULL'],
    ['not_found', 404, undefined],
  ])('K1-50a (34c2985): RPC says %s → %d', async (status, code, errCode) => {
    mockNext = (q) => (q[0] === 'from:matches' ? { data: { join_policy: 'open', status: 'scheduled', created_by: 'x' } } : { data: [] });
    rpc.mockResolvedValueOnce({ data: [{ status, players_needed: 0 }], error: null });
    const r = await call(joinOpenMatch, {});
    expect(r.statusCode).toBe(code);
    if (errCode) expect(r.body.code).toBe(errCode);
    expect(rpc).toHaveBeenLastCalledWith('join_open_match', { p_match_id: MATCH, p_user_id: ME });
    // the seat is taken inside the RPC, never by a read-then-insert here
    expect(mockLog.some((q) => q[0] === 'from:match_participants' && q.some((c) => c.startsWith('insert:')))).toBe(false);
  });
});
