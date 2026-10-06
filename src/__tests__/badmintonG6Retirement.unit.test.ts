/**
 * Badminton gap 6 (Oct 2026) · retirement: "ret." with the score as it stood;
 * the other side wins, and (Oct 2026, Dipak's decision) it is rated as a played
 * match — a loss for the side that retired; a walkover stays unrated. And the BWF GCR group rule — a player
 * who withdraws or retires in the group stage has every group result deleted
 * (a tournament setting; tournaments without it keep results, as before).
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
const mockRpc = jest.fn(async (..._a: unknown[]): Promise<any> => ({ data: null, error: null }));
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: (...a: unknown[]) => mockRpc(...a) } };
});
let mockBlocked = new Set<string>();
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => mockBlocked) }));
let mockOrganiser = false;
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  canOfficiateMatch: jest.fn(async () => true),
  isTournamentOrganiser: jest.fn(async () => mockOrganiser),
}));
jest.mock('../utils/scoringLease', () => ({
  ...jest.requireActual('../utils/scoringLease'),
  checkLease: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../utils/singles', () => ({
  ...jest.requireActual('../utils/singles'),
  pendingRankedOpponent: jest.fn(async () => ({ pending: false, opponentName: null })),
}));
let mockSport: Record<string, unknown> = { slug: 'badminton', allows_draw: false };
jest.mock('../utils/sportCache', () => ({
  ...jest.requireActual('../utils/sportCache'),
  getSport: jest.fn(async () => mockSport),
}));
jest.mock('../utils/testContent', () => ({
  ...jest.requireActual('../utils/testContent'),
  hideTestFor: jest.fn(async () => false),
}));
const mockNotify = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../utils/notify', () => ({
  ...jest.requireActual('../utils/notify'),
  notifyUsers: (...a: unknown[]) => mockNotify(...a),
  notifyUser: jest.fn(async () => undefined),
}));

jest.mock('../controllers/tournaments.controller', () => ({
  ...jest.requireActual('../controllers/tournaments.controller'),
  advanceTournamentWinner: jest.fn(async () => undefined),
  recrownAfterVoidChange: jest.fn(async () => undefined),
}));
// eslint-disable-next-line import/first
import { completeMatch } from '../controllers/matches.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const MATCH = '22222222-2222-4222-8222-222222222222';
const TA = '44444444-4444-4444-8444-444444444444';
const TB = '55555555-5555-4555-8555-555555555555';
const call = async (body: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await completeMatch({ userId: ME, params: { id: MATCH }, query: {}, body, headers: {}, get: () => undefined, header: () => undefined } as any, r);
  return r;
};
const writes = () => mockLog.filter((q) => q.some((c) => /^(update|upsert):/.test(c)));
let events: unknown[] = [];
let format = 'round_robin';
let parts: unknown[] = [];
const setup = (extra: Record<string, unknown> = {}) => {
  mockNext = (q) => {
    if (q[0] === 'from:matches') {
      return { data: { id: MATCH, created_by: ME, umpire_id: null, status: 'scheduled', team_a_id: TA, team_b_id: TB, sport_id: 's',
        is_ranked: false, tournament_id: 'T', round: 1, next_match_id: null, group_label: null, team_a_name: 'Lions', team_b_name: 'Tigers',
        score_summary: {}, voided_at: null, format: 'T10', overs: 10, rules: { v: 1, style: 'limited', overs: 10, players: 11 }, toss_choice: null, ...extra } };
    }
    if (q[0] === 'from:tournaments') return { data: { format } };
    if (q[0] === 'from:match_events') return { data: events, count: events.length };
    if (q[0] === 'from:match_participants') return { data: parts };
    return { data: null };
  };
};
beforeEach(() => {
  mockLog = [];
  mockSport = { slug: 'cricket', allows_draw: true };
  format = 'round_robin';
  events = [];
  parts = [];
});
// eslint-disable-next-line import/first
import { settingsRefusal, storedSettings } from '../utils/tournamentSettings';
// eslint-disable-next-line import/first
import { computeStats } from '../utils/standings';

const storedSummary = () => {
  for (const q of writes()) {
    const u = q.find((c) => c.startsWith('update:'));
    const row = u ? (JSON.parse(u.slice('update:'.length)) as Array<{ score_summary?: unknown }>)[0] : null;
    if (row?.score_summary) return row.score_summary as Record<string, unknown>;
  }
  return null;
};


const SCORE = { sets: [{ a: 21, b: 15 }, { a: 9, b: 15 }], current: { a: 3, b: 6 } };
describe('a retirement', () => {
  test('the other side wins; the score stays; the result says who retired', async () => {
    mockSport = { slug: 'badminton', allows_draw: false };
    setup({ status: 'live', score_summary: SCORE, rules: { v: 1, bestOf: 3, target: 21, cap: 30 }, format: 'bo3', overs: null });
    const r = await call({ retired: true, retired_team_id: TA, winner_team_id: TB, walkover_reason: 'Ankle' });
    expect(r.statusCode).toBe(200);
    const ss = storedSummary()!;
    expect(ss).toMatchObject({ retired: { team_id: TA, side: 'A', reason: 'Ankle' }, result: 'Tigers won (Lions retired)' });
    expect(ss.walkover).toBeUndefined();
    expect((ss.sets as unknown[]).length).toBe(2); // the score at retirement is kept
    const typed = writes().map((q) => q.find((c) => c.startsWith('update:'))).filter(Boolean).map((u) => JSON.parse(u!.slice(7))[0]).find((u) => u.result_type);
    expect(typed.result_type).toBe('retired');
  });
  test('it must name the side that retired, the other side winning, in a match being played', async () => {
    mockSport = { slug: 'badminton', allows_draw: false };
    setup({ status: 'live' });
    expect((await call({ retired: true, winner_team_id: TB })).body.code).toBe('BAD_RETIREMENT');
    expect((await call({ retired: true, retired_team_id: TB, winner_team_id: TB })).body.code).toBe('BAD_RETIREMENT');
    setup({ status: 'scheduled' });
    expect((await call({ retired: true, retired_team_id: TA, winner_team_id: TB })).body.code).toBe('NOT_LIVE');
    expect(writes()).toHaveLength(0);
  });
});

// eslint-disable-next-line import/first
import { tableInputs } from '../utils/tournamentSettings';

describe('the GCR group rule', () => {
  const m = (a: string, b: string, w: string) => ({ team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed', score_summary: {} });
  const ms = [m('A', 'B', 'A'), m('A', 'C', 'A'), m('B', 'C', 'C')];
  test('delete: the withdrawn entry and every result it played leave the table', () => {
    const t = tableInputs({ withdrawnResults: 'delete' }, ['A', 'B', 'C'], ms, ['A']);
    expect(t.teamIds).toEqual(['B', 'C']);
    expect(t.matches).toEqual([m('B', 'C', 'C')]);
    expect(computeStats(t.teamIds, t.matches as never).get('B')).toMatchObject({ played: 1, lost: 1 });
  });
  test('without the setting (every existing tournament): nothing changes', () => {
    expect(tableInputs(null, ['A', 'B', 'C'], ms, ['A'])).toEqual({ teamIds: ['A', 'B', 'C'], matches: ms });
    expect(tableInputs({ withdrawnResults: 'keep' }, ['A', 'B', 'C'], ms, ['A']).matches).toHaveLength(3);
  });
  test('the setting is checked and stored', () => {
    expect(settingsRefusal('badminton', 'round_robin', { withdrawnResults: 'delete' })).toBeNull();
    expect(settingsRefusal('badminton', 'round_robin', { withdrawnResults: 'maybe' })!.error).toBe('A withdrawn player’s group results are deleted or kept.');
    expect(storedSettings({ withdrawnResults: 'delete' })).toEqual({ v: 1, withdrawnResults: 'delete' });
    expect(storedSettings({ withdrawnResults: 'keep' }, { v: 1, withdrawnResults: 'delete' })).toEqual({ v: 1 });
  });
});

describe('ratings (Dipak, Oct 2026): a retirement was played, a walkover wasn’t', () => {
  const finalize = () => mockRpc.mock.calls.find((c) => c[0] === 'finalize_match')?.[1] as { p_results: { rating_history: Array<{ user_id: string; delta: number }>; profiles: unknown[] } } | undefined;
  beforeEach(() => { mockRpc.mockClear(); mockSport = { slug: 'badminton', allows_draw: false }; parts = [{ user_id: 'ua', team_side: 'A' }, { user_id: 'ub', team_side: 'B' }]; });
  test('a retirement in a ranked match: a loss for the side that retired, a win for the other', async () => {
    setup({ status: 'live', is_ranked: true, score_summary: SCORE, rules: { v: 1, bestOf: 3, target: 21, cap: 30 }, format: 'bo3', overs: null });
    const r = await call({ retired: true, retired_team_id: TA, winner_team_id: TB, winner_side: 'B', walkover_reason: 'Ankle' });
    expect(r.statusCode).toBe(200);
    const rh = finalize()!.p_results.rating_history;
    expect(rh.map((x) => x.user_id).sort()).toEqual(['ua', 'ub']);
    expect(rh.find((x) => x.user_id === 'ua')!.delta).toBeLessThan(0);
    expect(rh.find((x) => x.user_id === 'ub')!.delta).toBeGreaterThan(0);
  });
  test('a walkover in a ranked match moves nothing (as before)', async () => {
    setup({ status: 'scheduled', is_ranked: true, rules: { v: 1, bestOf: 3, target: 21, cap: 30 }, format: 'bo3', overs: null });
    const r = await call({ walkover: true, winner_team_id: TB, winner_side: 'B' });
    expect(r.statusCode).toBe(200);
    expect(finalize()?.p_results.rating_history ?? []).toEqual([]);
    expect(finalize()?.p_results.profiles ?? []).toEqual([]);
  });
});
