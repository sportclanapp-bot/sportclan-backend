/**
 * Phase 4 · K1 — early match fixes (completion). Harness copied from
 * phase3MatchesB05.unit.test.ts: every `from()` starts its own query, and each
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
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => new Set()) }));
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  canOfficiateMatch: jest.fn(async () => true),
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
jest.mock('../utils/sportCache', () => ({
  ...jest.requireActual('../utils/sportCache'),
  getSport: jest.fn(async () => ({ slug: 'football' })),
}));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []), allowedRecipients: jest.fn(async () => []),
}));
jest.mock('../controllers/matchFeatures.controller', () => ({
  ...jest.requireActual('../controllers/matchFeatures.controller'),
  calculateAndSetMVP: jest.fn(async () => null),
}));

// eslint-disable-next-line import/first
import { completeMatch, setMatchTossHandler } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { supabase } from '../utils/supabase';

const ME = '11111111-1111-4111-8111-111111111111';
const MATCH = '22222222-2222-4222-8222-222222222222';
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
const matchUpdates = () => mockLog
  .filter((q) => q[0] === 'from:matches')
  .flatMap((q) => q.filter((c) => c.startsWith('update:')).map((c) => JSON.parse(c.slice(7))[0]));

// A casual match made from two typed team names: no team ids, no roster.
const casual = {
  id: MATCH, created_by: ME, umpire_id: null, status: 'live', team_a_id: null, team_b_id: null,
  team_a_name: 'Sharks', team_b_name: 'Jets', sport_id: 'sport-football', is_ranked: false,
  tournament_id: null, round: null, format: null, overs: null, score_summary: {}, toss_choice: null, voided_at: null,
};

beforeEach(() => {
  mockLog = [];
  (supabase.rpc as jest.Mock).mockClear();
  mockNext = (q) => {
    if (q[0] === 'from:matches' && q.some((c) => c.startsWith('maybeSingle'))) return { data: casual };
    if (q[0] === 'from:match_participants') return { data: [] }; // nobody on the roster
    return { data: null };
  };
});

describe('K1-18 (89dd9dc) · a match with no participants can still be completed', () => {
  test('K1-18 (89dd9dc): casual free-text match, empty roster → 200, marked completed with the winning side', async () => {
    const r = await call(completeMatch, { body: { winner_side: 'A' } });
    expect(r.body?.error).toBeUndefined();
    expect(r.statusCode).toBe(200);
    // The match is finalised (status → completed happens inside finalize_match).
    expect((supabase.rpc as jest.Mock).mock.calls.some((c) => c[0] === 'finalize_match' && c[1].p_match_id === MATCH)).toBe(true);
    const ups = matchUpdates();
    // K1-28 (4241ece): the winner is recorded BY SIDE when there are no team ids.
    expect(ups.some((u) => u.score_summary?.winner_side === 'A')).toBe(true);
  });
});

describe('K1-28c (4241ece, L-003) · the toss winner is stored BY SIDE for free-text teams', () => {
  test('K1-28c (4241ece): no team ids, tossWinnerSide B → score_summary.toss_winner_side = "B" on the toss write', async () => {
    mockNext = (q) => (q[0] === 'from:matches' && q.some((c) => c.startsWith('maybeSingle'))
      ? { data: { ...casual, status: 'scheduled' } }
      : q[0] === 'from:matches' && q.some((c) => c.startsWith('single')) ? { data: { id: MATCH } } : { data: null });
    const r = await call(setMatchTossHandler, { body: { tossChoice: 'bowl', tossWinnerSide: 'B' } });
    expect(r.statusCode).toBe(200);
    const toss = matchUpdates().find((u) => u.toss_choice === 'bowl')!;
    expect(toss.toss_winner_team_id).toBeNull();
    expect(toss.score_summary.toss_winner_side).toBe('B');
  });
});
