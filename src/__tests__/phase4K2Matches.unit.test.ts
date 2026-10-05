/**
 * Phase 4 · K2 — regression tests for backend match-controller fixes (see the
 * app repo's phase4/K2.md). Supabase is mocked like phase3MatchesB05: every
 * `from()` starts its own query, resolved by `mockNext(q)`.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockRpcCalls: Array<[string, any]> = [];
let mockRpc: (name: string, args: any) => { data?: unknown; error?: unknown } = () => ({ data: null, error: null });
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
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async (n: string, a: any) => { mockRpcCalls.push([n, a]); return { data: null, error: null, ...mockRpc(n, a) }; }) } };
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
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), validateSportForCreate: jest.fn(async () => null), isSportInactive: jest.fn(async () => false) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s?: string) => (s === 'cricket' ? 'sport-cricket' : undefined)) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
// eslint-disable-next-line import/first
import { getSport } from '../utils/sportCache';
// eslint-disable-next-line import/first
import { addParticipants, getMatchChat, rateMatchHandler, getCommentary, completeMatch, createMatch, updateMatch, getMatch, abandonMatch, cancelMatch } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { decideMatchJoinRequest } from '../controllers/matchJoinRequests.controller';
// eslint-disable-next-line import/first
import { canOfficiateMatch } from '../utils/tournamentAuth';
// eslint-disable-next-line import/first
import { notifyUsers, matchAudienceIds } from '../utils/notify';

// A start a week ahead: a fixed date (it was 5 Oct 2026) turns into a refused
// past start the day it passes, and every create test then fails with 400.
const FUTURE = new Date(Date.now() + 7 * 864e5).toISOString();

const ME = '11111111-1111-4111-8111-111111111111';
const MATCH = '22222222-2222-4222-8222-222222222222';
const TA = '33333333-3333-4333-8333-333333333333';
const TB = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn(), on: jest.fn(), once: jest.fn() };
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

beforeEach(() => {
  mockLog = [];
  mockRpcCalls = [];
  mockRpc = () => ({ data: null, error: null });
  mockNext = () => ({ data: null, error: null });
  mockBlocked = new Set();
  mockPending = false;
});

describe('K2-2a · addParticipants: finished line-ups are frozen, sides are A/B (SC-98/110)', () => {
  it.each(['completed', 'abandoned', 'cancelled'])('K2-2a (99ffb16): a %s match → 409, nothing written', async (status) => {
    mockNext = onMatch(matchRow({ status }));
    const r = await call(addParticipants, { body: { participants: [{ user_id: OTHER, team_side: 'A' }] } });
    expect([r.statusCode, r.body.error]).toEqual([409, 'This match is already finished.']);
    expect(writes()).toHaveLength(0);
  });
  it.each(['C', undefined, 'a'])('K2-2a (99ffb16): team_side %j → 400', async (team_side) => {
    mockNext = onMatch(matchRow());
    const r = await call(addParticipants, { body: { participants: [{ user_id: OTHER, team_side }] } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'team_side must be A or B']);
    expect(writes()).toHaveLength(0);
  });
});

describe('K2-10b · addParticipants caps the array (AUDIT-5)', () => {
  it('K2-10b (d02809c): 51 participants → 400 before any query', async () => {
    const participants = Array.from({ length: 51 }, (_, i) => ({ user_id: `u${i}`, team_side: 'A' }));
    const r = await call(addParticipants, { body: { participants } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'Too many participants (max 50)']);
    expect(mockLog).toHaveLength(0);
  });
});

describe('K2-2i · the match chat is for people in the match (SC-107)', () => {
  it('K2-2i (99ffb16): a stranger → 403, never added to the chat', async () => {
    mockNext = onMatch(matchRow({ created_by: OTHER, chat_id: 'chat-1' }));
    const r = await call(getMatchChat, {});
    expect([r.statusCode, r.body.error]).toEqual([403, 'Not part of this match']);
    expect(writes()).toHaveLength(0);
  });
});

describe('K2-2j · only a completed match can be rated (SC-108)', () => {
  it.each(['scheduled', 'live'])('K2-2j (99ffb16): a %s match → 400, nothing written', async (status) => {
    mockNext = onMatch(matchRow({ status }));
    const r = await call(rateMatchHandler, { body: { matchQuality: 4, wouldPlayAgain: true } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'Can only rate a completed match']);
    expect(writes()).toHaveLength(0);
  });
  it('K2-2j (99ffb16): an unknown match → 404', async () => {
    const r = await call(rateMatchHandler, { body: { matchQuality: 4, wouldPlayAgain: true } });
    expect(r.statusCode).toBe(404);
  });
});

describe('K2-6c · commentary reads a bounded event log (SC-117)', () => {
  it('K2-6c (cdba317): match_events is read with limit 2000', async () => {
    mockNext = (q) => (q[0] === 'from:matches' ? { data: matchRow({ status: 'live' }) } : { data: [] });
    await call(getCommentary, {});
    const ev = mockLog.find((q) => q[0] === 'from:match_events')!;
    expect(ev).toContain('limit:[2000]');
  });
});

describe('K2-12 · completion persists through the atomic finalize_match RPC (SC-126)', () => {
  const live = (q: Q) => {
    if (q[0] === 'from:matches') return { data: matchRow({ status: 'live', is_ranked: false, team_a_id: null, team_b_id: null, score_summary: { A: { score: 2 }, B: { score: 1 } } }) };
    if (q[0] === 'from:match_participants') return { data: [{ user_id: ME, team_side: 'A' }, { user_id: OTHER, team_side: 'B' }] };
    return { data: null };
  };
  const completedWrites = () => mockLog.filter((q) => q[0] === 'from:matches' && q.some((c) => c.startsWith('update:') && c.includes('"status":"completed"')));
  it('K2-12 (d010d90): a failing RPC → 500 with no sequential fallback writes (match stays retryable)', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockNext = live;
    mockRpc = (n) => (n === 'finalize_match' ? { error: { code: '57014', message: 'statement timeout' } } : {});
    const r = await call(completeMatch, { body: {} });
    expect(mockRpcCalls.map(([n]) => n)).toContain('finalize_match');
    expect(r.statusCode).toBe(500);
    expect(completedWrites()).toHaveLength(0);
    expect(mockLog.filter((q) => ['from:user_sport_profiles', 'from:rating_history'].includes(q[0]) && q.some((c) => /^(insert|upsert|update):/.test(c)))).toHaveLength(0);
  });
  it('K2-12 (d010d90): the RPC answering applied:false (already completed) → 400, not a second apply', async () => {
    mockNext = live;
    mockRpc = (n) => (n === 'finalize_match' ? { data: { applied: false, match: { id: MATCH, status: 'completed' } } } : {});
    const r = await call(completeMatch, { body: {} });
    expect([r.statusCode, r.body.error]).toEqual([400, 'Match already completed']);
  });
});

describe('K2-39b / K2-40 · a decisive sport can’t be completed level without a winner (SC-227, now SC-268 allows_draw)', () => {
  const level = (q: Q) => {
    if (q[0] === 'from:matches') return { data: matchRow({ status: 'live', is_ranked: false, sport_id: 'sport-bb', score_summary: { A: { points: 80 }, B: { points: 80 } } }) };
    if (q[0] === 'from:match_participants') return { data: [{ user_id: ME, team_side: 'A' }, { user_id: OTHER, team_side: 'B' }] };
    return { data: null };
  };
  beforeEach(() => { (getSport as jest.Mock).mockImplementation(async () => ({ slug: 'basketball', allows_draw: false })); });
  afterEach(() => { (getSport as jest.Mock).mockImplementation(async () => ({ slug: 'cricket' })); });
  it('K2-39b (e2a1101): basketball 80–80, no winner → 400, never completed', async () => {
    mockNext = level;
    const r = await call(completeMatch, { body: {} });
    expect([r.statusCode, r.body.code]).toEqual([400, 'NEEDS_DECISIVE_WINNER']);
    expect(mockRpcCalls.map(([n]) => n)).not.toContain('finalize_match');
  });
  it('K2-40 (9f72efb): the same level score WITH a declared winner (forfeit / record-result) is allowed', async () => {
    mockNext = level;
    mockRpc = (n) => (n === 'finalize_match' ? { data: { applied: true, match: { id: MATCH, status: 'completed' } } } : {});
    const r = await call(completeMatch, { body: { winner_team_id: TA } });
    expect(r.body.code).not.toBe('NEEDS_DECISIVE_WINNER');
    expect(mockRpcCalls.map(([n]) => n)).toContain('finalize_match');
  });
});

describe('K2-50 · a team can’t play itself (SC-245)', () => {
  it('K2-50 (ba48a6f): createMatch with team_a_id === team_b_id → 400 SAME_TEAM, nothing inserted', async () => {
    mockNext = (q) => (q[0] === 'from:teams' ? { data: [{ id: TA, name: 'A', sport_id: 'cricket' }] } : { data: null });
    const r = await call(createMatch, { body: { sport_id: 'cricket', team_a_id: TA, team_b_id: TA, scheduled_at: FUTURE, venue: 'Oval' } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'SAME_TEAM']);
    expect(mockLog.filter((q) => q[0] === 'from:matches' && q.some((c) => c.startsWith('insert:')))).toHaveLength(0);
  });
  it('K2-50 (ba48a6f): updateMatch setting only team_b_id to the current team_a_id → 400 SAME_TEAM', async () => {
    mockNext = (q) => (q[0] === 'from:matches' ? { data: matchRow() } : q[0] === 'from:teams' ? { data: [{ id: TA, sport_id: 'sport-cricket' }] } : { data: null });
    const r = await call(updateMatch, { body: { team_b_id: TA } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'SAME_TEAM']);
    expect(writes()).toHaveLength(0);
  });
});

describe('K2-62 · an open match’s creator is in its line-up (SC-281)', () => {
  it('K2-62 (57cf537): createMatch is_open → the creator is inserted as a participant on side A', async () => {
    mockNext = (q) => (q[0] === 'from:matches' && q.some((c) => c.startsWith('insert:')) ? { data: { id: MATCH, is_open: true } } : { data: null });
    const r = await call(createMatch, { body: { sport_id: 'cricket', team_a_name: 'Lions', is_open: true, players_needed: 3, scheduled_at: FUTURE, venue: 'Oval' } });
    expect(r.statusCode).toBeLessThan(300);
    const seed = mockLog.find((q) => q[0] === 'from:match_participants' && q.some((c) => c.startsWith('insert:')))!;
    expect(seed.find((c) => c.startsWith('insert:'))).toBe(`insert:${JSON.stringify({ match_id: MATCH, user_id: ME, team_side: 'A' })}`);
  });
});

describe('K2-52 · the umpire-rating prompt fires for casual matches too (SC-249)', () => {
  it('K2-52 (691b9a1): a casual umpired match prompts every participant except the umpire', async () => {
    (notifyUsers as jest.Mock).mockClear();
    mockNext = (q) => {
      if (q[0] === 'from:matches') return { data: matchRow({ status: 'live', is_ranked: false, umpire_id: OTHER, team_a_id: null, team_b_id: null, score_summary: { A: { score: 2 }, B: { score: 1 } } }) };
      // A one-player casual line-up (plus the umpire): no ELO and no casual
      // attribution run, so allPlayerIds stays empty — the case SC-249 fixed.
      if (q[0] === 'from:match_participants') return { data: [{ user_id: ME, team_side: 'A' }, { user_id: OTHER, team_side: 'B' }].filter((p) => p.user_id === ME) };
      return { data: null };
    };
    mockRpc = (n) => (n === 'finalize_match' ? { data: { applied: true, match: { id: MATCH, status: 'completed' } } } : {});
    await call(completeMatch, { body: {} });
    await new Promise((x) => setTimeout(x, 20));
    const c = (notifyUsers as jest.Mock).mock.calls.find((a) => a[1]?.type === 'umpire_rating_prompt');
    expect(c?.[0]).toEqual([ME]);
  });
});

describe('K2-61 · a join request can’t be approved onto a started match (SC-280)', () => {
  it.each(['live', 'completed'])('K2-61 (d9e7927): approving on a %s match → 409 MATCH_NOT_JOINABLE, nothing written', async (status) => {
    mockNext = (q) => (q[0] === 'from:matches' ? { data: { created_by: ME, sport_id: 's', status } }
      : q[0] === 'from:match_join_requests' ? { data: { id: 'r1', status: 'pending' } } : { data: null });
    const r = await call(decideMatchJoinRequest, { params: { id: MATCH, userId: OTHER }, body: { status: 'approved' } });
    expect([r.statusCode, r.body.code]).toEqual([409, 'MATCH_NOT_JOINABLE']);
    expect(writes()).toHaveLength(0);
    expect(mockRpcCalls).toHaveLength(0);
  });
});

describe('K2-64 · getMatch tells the app whether the viewer can officiate (SC-287)', () => {
  it.each([true, false])('K2-64 (db37769): can_officiate mirrors canOfficiateMatch (%s)', async (v) => {
    (canOfficiateMatch as jest.Mock).mockImplementation(async () => v);
    mockNext = (q) => (q[0] === 'from:matches' ? { data: matchRow({ created_by: OTHER }) } : { data: null });
    const r = await call(getMatch, {});
    (canOfficiateMatch as jest.Mock).mockImplementation(async () => true);
    expect((r.body.match ?? r.body).can_officiate).toBe(v);
  });
});

describe('K2-54 · bracket-only guards key off the tournament FORMAT, not round (SC-257/258)', () => {
  const T = '66666666-6666-4666-8666-666666666666';
  const fixture = (format: string, status = 'live') => (q: Q) => {
    if (q[0] === 'from:tournaments') return { data: { format } };
    if (q[0] === 'from:matches') return { data: matchRow({ status, tournament_id: T, round: 1, group_label: null, is_ranked: false, score_summary: { A: { score: 1 }, B: { score: 1 } } }) };
    if (q[0] === 'from:match_participants') return { data: [{ user_id: ME, team_side: 'A' }, { user_id: OTHER, team_side: 'B' }] };
    return { data: null };
  };
  beforeEach(() => { (getSport as jest.Mock).mockImplementation(async () => ({ slug: 'football', allows_draw: true })); });
  afterEach(() => { (getSport as jest.Mock).mockImplementation(async () => ({ slug: 'cricket' })); });
  it.each(['round_robin', 'league'])('K2-54a (c9f484c): a level %s fixture completes as a draw (no BRACKET_NEEDS_WINNER)', async (fmt) => {
    mockNext = fixture(fmt);
    mockRpc = (n) => (n === 'finalize_match' ? { data: { applied: true, match: { id: MATCH, status: 'completed' } } } : {});
    const r = await call(completeMatch, { body: {} });
    expect(r.body?.code).not.toBe('BRACKET_NEEDS_WINNER');
    expect(mockRpcCalls.map(([n]) => n)).toContain('finalize_match');
  });
  it('K2-54a (c9f484c): a level KNOCKOUT fixture still needs a winner', async () => {
    mockNext = fixture('knockout');
    const r = await call(completeMatch, { body: {} });
    expect(r.body.code).toBe('BRACKET_NEEDS_WINNER');
  });
  it.each(['round_robin', 'league'])('K2-54b (c9f484c): abandoning a %s fixture needs no advancing team — it just goes abandoned', async (fmt) => {
    mockNext = fixture(fmt, 'scheduled');
    const r = await call(abandonMatch, { body: {} });
    expect(r.body?.code).not.toBe('WALKOVER_TEAM_REQUIRED');
    expect(mockLog.some((q) => q[0] === 'from:matches' && q.some((c) => c.startsWith('update:') && c.includes('"status":"abandoned"')))).toBe(true);
  });
  it('K2-54b (c9f484c): a knockout fixture abandon still requires the advancing team', async () => {
    mockNext = fixture('knockout', 'scheduled');
    const r = await call(abandonMatch, { body: {} });
    expect([r.statusCode, r.body.code]).toEqual([400, 'WALKOVER_TEAM_REQUIRED']);
  });
});

describe('K2-57b · cancel / abandon reach the entrant teams, not only the line-up (SC-270)', () => {
  beforeEach(() => {
    (notifyUsers as jest.Mock).mockClear();
    (matchAudienceIds as jest.Mock).mockClear();
    (matchAudienceIds as jest.Mock).mockImplementation(async () => [ME, TB, OTHER]);
  });
  afterEach(() => (matchAudienceIds as jest.Mock).mockImplementation(async () => []));
  it('K2-57b (6c38300): abandon → matchAudienceIds(match, team_a, team_b), everyone but me notified', async () => {
    mockNext = (q) => (q[0] === 'from:matches' ? { data: matchRow({ status: 'live' }) } : { data: null });
    await call(abandonMatch, { body: {} });
    expect(matchAudienceIds).toHaveBeenCalledWith(MATCH, TA, TB);
    const c = (notifyUsers as jest.Mock).mock.calls.find((a) => a[1]?.type === 'match_abandoned')!;
    expect(c[0]).toEqual([TB, OTHER]);
  });
  it('K2-57b (6c38300): cancel → the same audience is told', async () => {
    mockNext = (q) => (q[0] === 'from:matches' ? { data: matchRow({ status: 'scheduled' }) } : { data: null });
    await call(cancelMatch, {});
    expect(matchAudienceIds).toHaveBeenCalledWith(MATCH, TA, TB);
    const c = (notifyUsers as jest.Mock).mock.calls.find((a) => a[1]?.type === 'match_cancelled')!;
    expect(c[0]).toEqual([ME, TB, OTHER]);
  });
});
