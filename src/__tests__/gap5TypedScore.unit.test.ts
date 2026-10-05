/**
 * Cricket gap 5 (5 Oct 2026) · a score typed in, not ball by ball. Each side's
 * runs, wickets and overs and who batted first, marked score_only; checked by
 * the shared typedScoreRefusal; the winner held to the runs; stored flat and
 * nested so NRR (with the all-out rule) and "won by N wickets" read it.
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
const typed = (a: object, b: object, first = 'A') => ({ score_only: true, first_batting_side: first, A: a, B: b });
/** The score_summary the completion wrote to the match. */
const stored = () => {
  for (const q of writes()) {
    const u = q.find((c) => c.startsWith('update:'));
    const row = u ? (JSON.parse(u.slice('update:'.length)) as Array<{ score_summary?: unknown }>)[0] : null;
    if (row?.score_summary) return row.score_summary as Record<string, unknown>;
  }
  return null;
};

describe('a typed cricket score', () => {
  test('Lions 142/6 in 10, Tigers 130 all out in 9.2: stored both ways, "Lions won by 12 runs"', async () => {
    setup();
    const r = await call({ winner_team_id: TA, winner_side: 'A', score_summary: typed({ runs: 142, wickets: 6, overs: '10' }, { runs: 130, wickets: 10, overs: '9.2', all_out: true }) });
    expect(r.statusCode).toBe(200);
    const s = stored();
    expect(s).toMatchObject({
      score_only: true, first_batting_side: 'A',
      A: { runs: 142, score: 142, wickets: 6, balls: 60, all_out: false },
      B: { runs: 130, wickets: 10, balls: 56, all_out: true },
      team_a_score: 142, team_b_score: 130, team_a_overs: '10.0', team_b_overs: '9.2',
    });
    expect(writes().map((q) => q.join()).join(' ')).toContain('Lions won by 12 runs');
  });
  test('the chase won: "Tigers won by 4 wickets" (wickets in hand from the rules’ 11 a side)', async () => {
    setup();
    const r = await call({ winner_team_id: TB, winner_side: 'B', score_summary: typed({ runs: 120, wickets: 9, overs: '10' }, { runs: 121, wickets: 6, overs: '8.4' }) });
    expect(r.statusCode).toBe(200);
    expect(writes().map((q) => q.join()).join(' ')).toContain('Tigers won by 4 wickets');
  });
  test('the winner is the side with more runs; level is a tie in a league', async () => {
    setup();
    expect((await call({ winner_team_id: TB, winner_side: 'B', score_summary: typed({ runs: 142, wickets: 6, overs: '10' }, { runs: 130, wickets: 9, overs: '10' }) })).body)
      .toMatchObject({ code: 'SCORE_WINNER_MISMATCH', error: 'The score says Lions won.' });
    // A tie is sent as an explicit draw (is_draw), like any drawn result.
    expect((await call({ is_draw: true, score_summary: typed({ runs: 142, wickets: 6, overs: '10' }, { runs: 130, wickets: 9, overs: '10' }) })).body.code).toBe('SCORE_WINNER_MISMATCH');
    expect((await call({ winner_team_id: TA, winner_side: 'A', score_summary: typed({ runs: 100, wickets: 6, overs: '10' }, { runs: 100, wickets: 9, overs: '10' }) })).body.code).toBe('SCORE_WINNER_MISMATCH');
    const tie = await call({ is_draw: true, score_summary: typed({ runs: 100, wickets: 6, overs: '10' }, { runs: 100, wickets: 9, overs: '10' }) });
    expect(tie.statusCode).toBe(200);
    expect(writes().map((q) => q.join()).join(' ')).toContain('Tied');
  });
  test('a tied knockout needs the winner (decided by a super over), and takes it', async () => {
    format = 'knockout';
    setup();
    expect((await call({ is_draw: true, score_summary: typed({ runs: 100, wickets: 6, overs: '10' }, { runs: 100, wickets: 9, overs: '10' }) })).body.code).toBe('BRACKET_NEEDS_WINNER');
    expect((await call({ winner_team_id: TB, winner_side: 'B', score_summary: typed({ runs: 100, wickets: 6, overs: '10' }, { runs: 100, wickets: 9, overs: '10' }) })).statusCode).toBe(200);
  });
  test('refusals name the field', async () => {
    setup();
    const bad = async (a: object, b: object, first = 'A') => (await call({ winner_team_id: TA, winner_side: 'A', score_summary: typed(a, b, first) })).body;
    expect(await bad({ runs: 1000, wickets: 1, overs: '10' }, { runs: 1, wickets: 1, overs: '1' })).toMatchObject({ code: 'BAD_SCORE', field: 'A.runs' });
    expect(await bad({ runs: 100, wickets: 11, overs: '10' }, { runs: 1, wickets: 1, overs: '1' })).toMatchObject({ field: 'A.wickets', error: 'Wickets must be a whole number from 0 to 10.' });
    expect(await bad({ runs: 100, wickets: 1, overs: '9.6' }, { runs: 1, wickets: 1, overs: '1' })).toMatchObject({ field: 'A.overs' });
    expect(await bad({ runs: 100, wickets: 1, overs: '10.1' }, { runs: 1, wickets: 1, overs: '1' })).toMatchObject({ field: 'A.overs', error: 'No side can bat more than the match\'s 10 overs.' });
    expect(await bad({ runs: 100, wickets: 1, overs: '10' }, { runs: 1, wickets: 1, overs: '1' }, 'C')).toMatchObject({ field: 'first_batting_side' });
    expect((await call({ winner_team_id: TB, winner_side: 'B', score_summary: typed({ runs: 100, wickets: 1, overs: '10' }, { runs: 108, wickets: 1, overs: '8' }) })).body)
      .toMatchObject({ field: 'B.runs', code: 'BAD_SCORE' });
    expect(writes()).toHaveLength(0);
  });
  test('not once a ball has been scored', async () => {
    events = [{ event_type: 'ball', payload: { team_side: 'A', runs: 1 } }];
    setup();
    expect((await call({ winner_team_id: TA, winner_side: 'A', score_summary: typed({ runs: 142, wickets: 6, overs: '10' }, { runs: 130, wickets: 9, overs: '10' }) })).body.code).toBe('SCORE_ONLY_AFTER_BALLS');
  });
});

describe('NRR from a typed score', () => {
  test('counted like a scored match; the side all out is charged its full 10 overs', async () => {
    const { computeStats } = jest.requireActual('../utils/standings') as typeof import('../utils/standings');
    setup();
    await call({ winner_team_id: TA, winner_side: 'A', score_summary: typed({ runs: 142, wickets: 6, overs: '10' }, { runs: 130, wickets: 10, overs: '9.2', all_out: true }) });
    const m = { id: MATCH, team_a_id: TA, team_b_id: TB, winner_team_id: TA, status: 'completed', voided_at: null, overs: 10, score_summary: stored() };
    const t = computeStats([TA, TB], [m as never]);
    // Lions 142/10 − 130/10 = +1.2; Tigers 130/10 (all out: the full quota) − 142/10 = −1.2.
    expect(t.get(TA)).toMatchObject({ oversFaced: 10, oversBowled: 10, nrr: 1.2 });
    expect(t.get(TB)).toMatchObject({ oversFaced: 10, nrr: -1.2 });
  });
});
