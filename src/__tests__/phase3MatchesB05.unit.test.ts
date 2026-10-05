/**
 * Phase 3 · B05 Matches (28 Sep 2026) — the backend fixes. See the app repo's
 * phase3/B05.md for each finding. Supabase is mocked: every `from()` starts its
 * own query, and each resolves to `mockNext(q)`, where `q` lists that query's
 * builder calls. `mockLog` keeps every query in order.
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
import {
  setMatchTossHandler, rateMatchHandler, completeMatch, updateMatch, addParticipants, listMatches, listOpenMatches,
  claimScoringLease, takeOverScoringLease, formatRefusal, scheduleRefusal, participantRowRefusal, TAKEOVER_REASON_MAX,
} from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { upsertInningsStats, inningsRowRefusal } from '../controllers/matchFeatures.controller';
// eslint-disable-next-line import/first
import { createInvite, respondToInvite, INVITE_MESSAGE_MAX } from '../controllers/invites.controller';
// eslint-disable-next-line import/first
import { isSinglesShape } from '../utils/singles';

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

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockBlocked = new Set();
  mockPending = false;
});

describe('F3 · the toss starts the match only once the ranked opponent accepted', () => {
  test('pending opponent → 409 OPPONENT_NOT_ACCEPTED, nothing written', async () => {
    mockPending = true;
    mockNext = onMatch(matchRow({ is_ranked: true, team_a_id: null, team_b_id: null }));
    const r = await call(setMatchTossHandler, { body: { tossChoice: 'bat', tossWinnerSide: 'A' } });
    expect(r.statusCode).toBe(409);
    expect(r.body.code).toBe('OPPONENT_NOT_ACCEPTED');
    expect(writes()).toHaveLength(0);
  });
  test('control: an accepted match goes live', async () => {
    mockNext = onMatch(matchRow({ is_ranked: true, team_a_id: null, team_b_id: null }));
    const r = await call(setMatchTossHandler, { body: { tossChoice: 'bowl', tossWinnerSide: 'B' } });
    expect(r.statusCode).toBe(200);
    expect(writes()[0].join()).toContain('"status":"live"');
  });
});

describe('F4 · toss fields are checked', () => {
  test.each([
    [{ tossChoice: { x: 1 } }, 'BAD_TOSS_CHOICE'],
    [{ tossChoice: 'serve' }, 'BAD_TOSS_CHOICE'],
    [{ tossChoice: 'bat', tossWinnerSide: 'C' }, 'BAD_TOSS_SIDE'],
    [{ tossChoice: 'bat', tossWinnerTeamId: 'nope' }, 'BAD_TOSS_WINNER'],
    [{ tossChoice: 'bat', tossWinnerTeamId: OTHER }, 'BAD_TOSS_WINNER'],
  ])('%j → 400 %s', async (body, code) => {
    mockNext = onMatch(matchRow());
    const r = await call(setMatchTossHandler, { body });
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe(code);
    expect(writes()).toHaveLength(0);
  });
  test('a team of the match is a fine toss winner', async () => {
    mockNext = onMatch(matchRow());
    expect((await call(setMatchTossHandler, { body: { tossChoice: 'bat', tossWinnerTeamId: TB, tossWinnerSide: 'B' } })).statusCode).toBe(200);
  });
});

describe('F5 · completion: the winner is one of the two teams', () => {
  test.each(['nope', OTHER])('winner_team_id %s → 400 BAD_WINNER, nothing written', async (w) => {
    mockNext = onMatch(matchRow({ status: 'live' }));
    const r = await call(completeMatch, { body: { winner_team_id: w } });
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('BAD_WINNER');
    expect(writes()).toHaveLength(0);
  });
});

describe('F8 · only people in a completed, counted match rate it', () => {
  const body = { matchQuality: 4, wouldPlayAgain: true };
  test('2.5 stars → 400', async () => {
    expect((await call(rateMatchHandler, { body: { ...body, matchQuality: 2.5 } })).statusCode).toBe(400);
  });
  test('voided → 409 MATCH_VOIDED', async () => {
    mockNext = onMatch(matchRow({ status: 'completed', voided_at: '2026-09-28T00:00:00Z', created_by: OTHER }));
    const r = await call(rateMatchHandler, { body });
    expect([r.statusCode, r.body.code]).toEqual([409, 'MATCH_VOIDED']);
  });
  test('a stranger → 403 NOT_IN_MATCH, nothing written', async () => {
    mockNext = onMatch(matchRow({ status: 'completed', created_by: OTHER }));
    const r = await call(rateMatchHandler, { body });
    expect([r.statusCode, r.body.code]).toEqual([403, 'NOT_IN_MATCH']);
    expect(writes()).toHaveLength(0);
  });
  test('someone in the line-up → rated', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:matches') return { data: matchRow({ status: 'completed', created_by: OTHER }) };
      if (q[0] === 'from:match_participants') return { data: { user_id: ME } };
      if (q[0] === 'from:match_ratings' && q.some((c) => c.startsWith('insert:'))) return { data: { id: 'r1' } };
      return { data: null };
    };
    const r = await call(rateMatchHandler, { body });
    expect(r.statusCode).toBe(200);
    expect(r.body.rating).toEqual({ id: 'r1' });
  });
});

describe('F2 · PATCH /matches/:id checks every key with create’s rules', () => {
  test.each([
    [{ scheduled_at: 'garbage' }, 'BAD_SCHEDULED_AT'],
    [{ scheduled_at: '2020-01-01T00:00:00Z' }, 'SCHEDULED_IN_PAST'],
    [{ scheduled_at: '9999-12-31T00:00:00Z' }, 'SCHEDULED_TOO_FAR'],
    [{ city_id: 'nope' }, 'BAD_CITY'],
    [{ team_a_name: 'x'.repeat(300) }, 'TEAM_NAME_TOO_LONG'],
    [{ overs: 'abc' }, 'BAD_OVERS'],
    [{ format: 'x'.repeat(1000) }, 'BAD_FORMAT'],
    [{ venue: '' }, 'VENUE_REQUIRED'],
  ])('%j → 400 %s, nothing written', async (body, code) => {
    mockNext = onMatch(matchRow({ team_a_id: null, team_b_id: null }));
    const r = await call(updateMatch, { body });
    expect([r.statusCode, r.body.code]).toEqual([400, code]);
    expect(writes()).toHaveLength(0);
  });
  test('an empty name on a typed-in side → 400 TEAM_NAME_REQUIRED', async () => {
    mockNext = onMatch(matchRow({ team_a_id: null, team_b_id: null }));
    const r = await call(updateMatch, { body: { team_a_name: '  ' } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'TEAM_NAME_REQUIRED']);
  });
  test('an unknown team id → 400 TEAM_NOT_FOUND', async () => {
    mockNext = onMatch(matchRow());
    const r = await call(updateMatch, { body: { team_a_id: OTHER } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'TEAM_NOT_FOUND']);
  });
  test('valid edits still go through; names are stored trimmed', async () => {
    mockNext = onMatch(matchRow({ team_a_id: null, team_b_id: null }));
    const r = await call(updateMatch, { body: { team_a_name: '  Pune XI  ' } });
    expect(r.statusCode).toBe(200);
    expect(writes()[0].join()).toContain('"team_a_name":"Pune XI"');
  });
});

describe('Decision 18 · PATCH /matches/:id sets no result (B05-D1)', () => {
  test.each([
    [{ status: 'completed' }, 'status'],
    [{ status: 'live' }, 'status'],
    [{ status: 'banana' }, 'status'],
    [{ winner_team_id: TA }, 'winner_team_id'],
    [{ winner_team_id: null }, 'winner_team_id'],
    [{ score_summary: { A: { runs: 99 } } }, 'score_summary'],
    [{ venue: 'Ground 2', score_summary: null }, 'score_summary'],
  ])('%j → 400 RESULT_NOT_EDITABLE naming %s, pointing at /complete, nothing written', async (body, field) => {
    mockNext = onMatch(matchRow());
    const r = await call(updateMatch, { body });
    expect([r.statusCode, r.body.code, r.body.field]).toEqual([400, 'RESULT_NOT_EDITABLE', field]);
    expect(r.body.error).toContain('/matches/:id/complete');
    expect(writes()).toHaveLength(0);
  });
  test('a stranger is still refused first (403, not a hint about the fields)', async () => {
    mockNext = onMatch(matchRow({ created_by: OTHER }));
    const r = await call(updateMatch, { body: { status: 'completed' } });
    expect(r.statusCode).toBe(403);
  });
  test('status "cancelled" still goes through, as do the other fields', async () => {
    mockNext = onMatch(matchRow());
    const r = await call(updateMatch, { body: { status: 'cancelled', venue: 'Ground 2' } });
    expect(r.statusCode).toBe(200);
    expect(writes()[0].join()).toContain('"status":"cancelled"');
  });
  test('the app never calls this route with a result (its one call sends a fixture’s rules only, cricket gap 1)', () => {
    const app = path.join(__dirname, '../../../sportclan-v2/src/api/matches.ts');
    if (!fs.existsSync(app)) return; // the app repo isn't beside this one (CI)
    const calls = [...fs.readFileSync(app, 'utf8').matchAll(/client\.patch[^(]*\(\s*`\/matches\/\$\{id\}`\s*,\s*([^)]*)\)/g)].map((m) => m[1]!.trim());
    expect(calls).toEqual(['{ rules }']);
  });
});

describe('F9 · an invite is answered once', () => {
  test('a second answer → 409 INVITE_RESOLVED, nothing written', async () => {
    mockNext = (q) => (q[0] === 'from:invites' ? { data: { created_at: new Date().toISOString(), status: 'accepted', receiver_id: ME } } : { data: null });
    const r = await call(respondToInvite, { params: { id: 'i1' }, body: { status: 'declined' } });
    expect([r.statusCode, r.body.code]).toEqual([409, 'INVITE_RESOLVED']);
    expect(writes()).toHaveLength(0);
  });
  test('the update only touches a pending invite (a race loses with 409)', async () => {
    mockNext = (q) => (q[0] === 'from:invites' && !q.some((c) => c.startsWith('update:'))
      ? { data: { created_at: new Date().toISOString(), status: 'pending', receiver_id: ME } } : { data: null });
    const r = await call(respondToInvite, { params: { id: 'i1' }, body: { status: 'accepted' } });
    expect(r.statusCode).toBe(409);
    expect(writes()[0].join()).toContain('eq:["status","pending"]');
  });
});

describe('F10 · invite message, receiver and sport are checked', () => {
  const base = { receiver_id: OTHER, sport_id: TA };
  test('an object message → 400 BAD_MESSAGE', async () => {
    const r = await call(createInvite, { body: { ...base, message: { x: 1 } } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'BAD_MESSAGE']);
  });
  test(`over ${INVITE_MESSAGE_MAX} characters → 400 MESSAGE_TOO_LONG`, async () => {
    const r = await call(createInvite, { body: { ...base, message: 'x'.repeat(INVITE_MESSAGE_MAX + 1) } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'MESSAGE_TOO_LONG']);
  });
  test('an unknown receiver → 404, an unknown sport → 400; nothing written', async () => {
    let r = await call(createInvite, { body: base });
    expect([r.statusCode, r.body.code]).toEqual([404, 'RECEIVER_NOT_FOUND']);
    mockNext = (q) => (q[0] === 'from:users' ? { data: { id: OTHER, deleted_at: null } } : { data: null });
    r = await call(createInvite, { body: base });
    expect([r.statusCode, r.body.code]).toEqual([400, 'BAD_SPORT']);
    expect(writes()).toHaveLength(0);
  });
});

describe('F14 · line-up rows are checked', () => {
  test.each([
    [{ user_id: 'nope', team_side: 'A' }, 'BAD_PLAYER'],
    [{ user_id: OTHER, team_side: 'A', jersey_number: 'ten' }, 'BAD_JERSEY'],
    [{ user_id: OTHER, team_side: 'A', role: 'r'.repeat(502) }, 'BAD_ROLE'],
  ])('%j → %s', (row, code) => {
    expect(participantRowRefusal([row])?.code).toBe(code);
  });
  test('an unknown player → 404; a player the creator blocked → 403; nothing written', async () => {
    mockNext = onMatch(matchRow());
    let r = await call(addParticipants, { body: { participants: [{ user_id: OTHER, team_side: 'A' }] } });
    expect([r.statusCode, r.body.code]).toEqual([404, 'PLAYER_NOT_FOUND']);
    mockNext = (q) => (q[0] === 'from:matches' ? { data: matchRow() } : q[0] === 'from:users' ? { data: [{ id: OTHER, deleted_at: null }] } : { data: null });
    mockBlocked = new Set([OTHER]);
    r = await call(addParticipants, { body: { participants: [{ user_id: OTHER, team_side: 'A' }] } });
    expect([r.statusCode, r.body.code]).toEqual([403, 'BLOCKED_FROM_MATCH']);
    expect(writes()).toHaveLength(0);
  });
});

describe('F15 · innings stats are checked before they reach career stats', () => {
  test.each([
    [{ user_id: OTHER, runs: 'abc' }, 'BAD_STAT'],
    [{ user_id: OTHER, runs: -1 }, 'BAD_STAT'],
    [{ user_id: OTHER, innings_number: 3 }, 'BAD_INNINGS'],
    [{ user_id: 'x' }, 'BAD_PLAYER'],
  ])('%j → %s', (row, code) => {
    expect(inningsRowRefusal([row])?.code).toBe(code);
  });
  test('a player outside the line-up → 400 NOT_IN_LINEUP, nothing written', async () => {
    mockNext = (q) => (q[0] === 'from:matches' ? { data: matchRow({ status: 'live' }) } : q[0] === 'from:match_participants' ? { data: [{ user_id: ME }] } : { data: null });
    const r = await call(upsertInningsStats, { body: { stats: [{ user_id: OTHER, runs: 10 }] } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'NOT_IN_LINEUP']);
    expect(writes()).toHaveLength(0);
  });
});

describe('F16 · list filters: 400 for a bad id, never 500 or an unchecked .or()', () => {
  test.each([{ team_id: 'nope' }, { tournament_id: 'nope' }, { sport_id: 'nope' }, { sport_id: ['a', 'b'] }])('GET /matches %j → 400', async (query) => {
    const r = await call(listMatches, { query });
    expect(r.statusCode).toBe(400);
    expect(mockLog.filter((q) => q[0] === 'from:matches')).toHaveLength(0);
  });
  test.each([{ city_id: 'nope' }, { sport_id: 'nope' }])('GET /matches/open %j → 400', async (query) => {
    expect((await call(listOpenMatches, { query })).statusCode).toBe(400);
  });
});

describe('F17 · format and date on create', () => {
  test('cricket format: T<overs> matching overs, box or pair', () => {
    expect(formatRefusal('cricket', 'T20', 20)).toBeNull();
    expect(formatRefusal('cricket', 'box', 6)).toBeNull();
    expect(formatRefusal('cricket', 'pair', null)).toBeNull();
    expect(formatRefusal('cricket', 20, 20)?.code).toBe('BAD_FORMAT');
    expect(formatRefusal('cricket', { x: 1 }, 20)?.code).toBe('BAD_FORMAT');
    expect(formatRefusal('cricket', 'Test', 20)?.code).toBe('BAD_FORMAT');
    expect(formatRefusal('cricket', 'T20', 10)?.code).toBe('FORMAT_OVERS_MISMATCH');
  });
  test('other sports: short text (chess clocks, best-of presets)', () => {
    expect(formatRefusal('chess', '10+5', null)).toBeNull();
    expect(formatRefusal('badminton', 'bo3', null)).toBeNull();
    expect(formatRefusal('badminton', 'x'.repeat(21), null)?.code).toBe('BAD_FORMAT');
  });
  test('within the next year', () => {
    expect(scheduleRefusal(new Date(Date.now() + 86_400_000).toISOString())).toBeNull();
    expect(scheduleRefusal('9999-12-31T00:00:00Z')?.code).toBe('SCHEDULED_TOO_FAR');
    expect(scheduleRefusal({ x: 1 })?.code).toBe('BAD_SCHEDULED_AT');
  });
});

describe('F25 · no scoring lease on a finished match; the takeover reason is capped', () => {
  test('claim / takeover on a cancelled match → 409 MATCH_FINISHED', async () => {
    mockNext = onMatch(matchRow({ status: 'cancelled' }));
    let r = await call(claimScoringLease, {});
    expect([r.statusCode, r.body.code]).toEqual([409, 'MATCH_FINISHED']);
    r = await call(takeOverScoringLease, { body: { reason: 'phone died' } });
    expect([r.statusCode, r.body.code]).toEqual([409, 'MATCH_FINISHED']);
  });
  test('a reason over the cap → 400', async () => {
    mockNext = onMatch(matchRow({ status: 'live' }));
    const r = await call(takeOverScoringLease, { body: { reason: 'x'.repeat(TAKEOVER_REASON_MAX + 1) } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'REASON_TOO_LONG']);
  });
});

describe('F6 · an open pickup with one player a side is not singles', () => {
  const parts = [{ user_id: ME, team_side: 'A' }, { user_id: OTHER, team_side: 'B' }];
  test('open → false; a closed one-a-side match → true', () => {
    expect(isSinglesShape({ is_open: true }, parts)).toBe(false);
    expect(isSinglesShape({ is_open: false }, parts)).toBe(true);
  });
});

describe('F11 · the match says whether the viewer has a join request', () => {
  test('getMatch reads the viewer’s request and exposes pending / rejected only', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8');
    expect(src).toMatch(/from\('match_join_requests'\)\.select\('status'\)\.eq\('match_id', id\)\.eq\('user_id', userId\)/);
    expect(src).toMatch(/my_join_request = myJoinRequest === 'pending' \|\| myJoinRequest === 'rejected' \? myJoinRequest : null/);
  });
});
