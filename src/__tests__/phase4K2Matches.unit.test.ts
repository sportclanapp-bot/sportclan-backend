/**
 * Phase 4 · K2 — regression tests for backend match-controller fixes (see the
 * app repo's phase4/K2.md). Supabase is mocked like phase3MatchesB05: every
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
import { addParticipants, getMatchChat, rateMatchHandler, getCommentary } from '../controllers/matches.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const MATCH = '22222222-2222-4222-8222-222222222222';
const TA = '33333333-3333-4333-8333-333333333333';
const TB = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn(), on: jest.fn() };
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
