/**
 * Phase 4 · K3 — POST /matches/:id/complete regressions (SC-373/376, M1…).
 * Supabase is a recording chain: every from()/rpc() starts its own query and
 * resolves to mockNext(q). The canonical recompute, lease, officiating check
 * and after-response side effects are stubbed.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number | null } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert', 'filter', 'match', 'contains', 'overlaps', 'textSearch', 'returns', 'abortSignal']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    const done = () => ({ data: null, error: null, ...mockNext(q) });
    chain.single = jest.fn(async () => { q.push('single'); return done(); });
    chain.maybeSingle = jest.fn(async () => { q.push('maybeSingle'); return done(); });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok(done())); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn((t: string) => start(`from:${t}`)), rpc: jest.fn((n: string, args?: unknown) => start(`rpc:${n}:${JSON.stringify(args ?? null)}`)) } };
});
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  canOfficiateMatch: jest.fn(async () => true),
  isTournamentOrganiser: jest.fn(async () => true),
}));
jest.mock('../utils/scoringLease', () => ({ ...jest.requireActual('../utils/scoringLease'), checkLease: jest.fn(async () => ({ ok: true })) }));
jest.mock('../utils/singles', () => ({ ...jest.requireActual('../utils/singles'), pendingRankedOpponent: jest.fn(async () => ({ pending: false })) }));
let mockSport: Record<string, unknown> = { slug: 'football' };
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => mockSport) }));
let mockCanonical: Record<string, unknown> | null = null;
jest.mock('../controllers/scoring.controller', () => ({
  ...jest.requireActual('../controllers/scoring.controller'),
  recomputeSummary: jest.fn(async () => mockCanonical),
  writeCricketInningsStats: jest.fn(async () => undefined),
}));
jest.mock('../controllers/matchFeatures.controller', () => ({ calculateAndSetMVP: jest.fn(async () => undefined) }));
jest.mock('../controllers/tournaments.controller', () => ({ advanceTournamentWinner: jest.fn(async () => undefined), recrownAfterVoidChange: jest.fn(async () => undefined) }));
jest.mock('../controllers/badges.controller', () => ({ awardBadgesSafe: jest.fn(async () => undefined), revokeRecordBadgesSafe: jest.fn(async () => undefined) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));
jest.mock('../utils/coins', () => ({ awardCoins: jest.fn(async () => undefined) }));
jest.mock('../utils/winCoins', () => ({ reconcileWinCoins: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { completeMatch } from '../controllers/matches.controller';

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
const call = async (body: object) => {
  const r = res();
  await completeMatch({ userId: ME, params: { id: MATCH }, query: {}, body, headers: {}, get: () => undefined, header: () => undefined } as any, r);
  await new Promise((ok) => setImmediate(ok));
  return r;
};
const matchRow = (extra: object = {}) => ({
  id: MATCH, created_by: ME, umpire_id: null, status: 'live', team_a_id: TA, team_b_id: TB, sport_id: 'sp',
  team_a_name: 'Pune XI', team_b_name: 'Mumbai XI', is_ranked: false, tournament_id: null, round: null, group_label: null,
  next_match_id: null, score_summary: null, toss_choice: null, format: null, overs: null, voided_at: null, ...extra,
});
/** The post-completion patch: the matches update that carries score_summary. */
const resultPatch = () => {
  const q = mockLog.find((x) => x[0] === 'from:matches' && x.some((c) => c.startsWith('update:') && c.includes('score_summary')));
  return q ? JSON.parse(q.find((c) => c.startsWith('update:'))!.slice('update:'.length))[0] : undefined;
};
let mockEvents = 0;
const base = (m: object) => (q: Q) => {
  if (q[0] === 'from:matches' && q.includes('maybeSingle')) return { data: m };
  if (q[0] === 'from:match_events') return { count: mockEvents, data: [] };
  if (q[0] === 'from:match_participants') return { data: [] };
  return { data: null };
};

beforeEach(() => {
  mockLog = []; mockNext = () => ({ data: null, error: null });
  mockSport = { slug: 'football' }; mockCanonical = null; mockEvents = 0;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('SC-373 · a draw is a first-class result', () => {
  it('K3-21 (ade75b6): a scheduled, unscored match can be completed as a draw (is_draw) — not "has not started"', async () => {
    mockNext = base(matchRow({ status: 'scheduled' }));
    const r = await call({ is_draw: true });
    expect(r.statusCode).toBe(200);
    expect(r.body?.error).toBeUndefined();
    expect(resultPatch()?.result_type).toBe('draw');
  });
  it('K3-21 (ade75b6): the guard itself still stands — no result of any kind → 400', async () => {
    mockNext = base(matchRow({ status: 'scheduled' }));
    const r = await call({});
    expect([r.statusCode, r.body.error]).toEqual([400, 'Cannot complete a match that has not started']);
  });
  it('K3-25 (10128c1): result_type is written on the post-completion patch (the path that runs) — decisive for a named winner', async () => {
    mockNext = base(matchRow());
    await call({ winner_team_id: TA });
    expect(resultPatch()?.result_type).toBe('decisive');
  });
});

describe('SC-376 · the score recorded with the result', () => {
  it('K3-24 / K3-25 (d0b3dca, 10128c1): a score_summary posted with the winner is stored when the match has no scoring events', async () => {
    mockNext = base(matchRow());
    await call({ winner_team_id: TA, score_summary: { team_a_score: 4, team_b_score: 1 } });
    const p = resultPatch();
    expect(p.score_summary.team_a_score).toBe(4);
    expect(p.score_summary.team_b_score).toBe(1);
  });
  it('K3-25 (10128c1): a live-scored match keeps its own score — the posted one is ignored', async () => {
    mockEvents = 12;
    mockCanonical = { A: { score: 2 }, B: { score: 0 } };
    mockNext = base(matchRow());
    await call({ winner_team_id: TA, score_summary: { team_a_score: 9, team_b_score: 9 } });
    const p = resultPatch();
    expect(p.score_summary.team_a_score).toBeUndefined();
    expect(p.score_summary.A.score).toBe(2);
  });
  it('K3-27 (1e23471): the result sentence reads the flat score — "4-1", never "0-0"', async () => {
    mockNext = base(matchRow());
    await call({ winner_team_id: TA, score_summary: { team_a_score: 4, team_b_score: 1 } });
    const text = String(resultPatch().score_summary.result);
    expect(text).toContain('Pune XI');
    expect(text).toContain('4');
    expect(text).not.toMatch(/0\s*[-–]\s*0/);
  });
});

describe('SC-392 · the activity streak is stamped with the IST day', () => {
  it('K3-37 (47daf3f): a match finished at 01:30 IST stamps last_match_date with that IST day', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-08-01T20:00:00Z'), doNotFake: ['setImmediate', 'setTimeout', 'setInterval', 'nextTick', 'queueMicrotask', 'clearTimeout', 'clearInterval', 'clearImmediate'] });
    try {
      mockNext = (q) => {
        if (q[0] === 'from:match_participants') return { data: [{ user_id: 'p1', team_side: 'A' }, { user_id: 'p2', team_side: 'B' }] };
        if (q[0] === 'from:users' && q.some((c) => c.startsWith('select:') && c.includes('streak_count'))) return { data: [{ id: 'p1', streak_count: 0, last_match_date: null }] };
        return base(matchRow())(q);
      };
      await call({ winner_team_id: TA });
      for (let i = 0; i < 30; i++) await new Promise((ok) => setImmediate(ok));
      const u = mockLog.find((q) => q[0] === 'from:users' && q.some((c) => c.startsWith('update:') && c.includes('last_match_date')));
      expect(u?.join()).toContain('"last_match_date":"2026-08-02"');
    } finally { jest.useRealTimers(); }
  });
});

describe('M1 · one result sentence, cricket-correct', () => {
  it('K3-63 / K3-71 (af3ca47, 383a6ae): a successful chase is "won by N wickets" — toss_choice is loaded and reaches the derivation', async () => {
    mockSport = { slug: 'cricket' };
    // A won the toss and chose to BAT, so B chased 150 and got there 3 down.
    mockCanonical = { A: { runs: 150, score: 150, wickets: 6, balls: 120 }, B: { runs: 151, score: 151, wickets: 3, balls: 100 }, toss_winner_side: 'A' };
    mockNext = base(matchRow({ toss_choice: 'bat', overs: 20, format: 'T20', score_summary: { toss_winner_side: 'A' } }));
    await call({ winner_team_id: TB });
    expect(resultPatch().score_summary.result).toBe('Mumbai XI won by 7 wickets');
    const sel = mockLog.find((q) => q[0] === 'from:matches' && q.includes('maybeSingle'))!.join();
    expect(sel).toContain('toss_choice');
  });
  it('K3-63 (af3ca47): defending a total is still "won by N runs"', async () => {
    mockSport = { slug: 'cricket' };
    mockCanonical = { A: { runs: 150, score: 150, wickets: 6, balls: 120 }, B: { runs: 140, score: 140, wickets: 10, balls: 110 }, toss_winner_side: 'A' };
    mockNext = base(matchRow({ toss_choice: 'bat', overs: 20, format: 'T20', score_summary: { toss_winner_side: 'A' } }));
    await call({ winner_team_id: TA });
    expect(resultPatch().score_summary.result).toBe('Pune XI won by 10 runs');
  });
});
