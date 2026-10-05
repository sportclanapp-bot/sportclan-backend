/**
 * Cricket gap 9 (5 Oct 2026) · a tied knockout's super overs scored ball by
 * ball (payload.super_over = 1, 2, …): kept out of the match's innings and
 * player figures; accepted only on a level knockout cricket fixture, in order;
 * the completion's winner held to the last super over; and the tournament's
 * fallback (higher seed by default, boundaries, a toss) when none can be played.
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
// eslint-disable-next-line import/first
import { superOversOf, mainEvents, boundariesOf, sideTotals, superOverNumber } from '../utils/cricketRules';
// eslint-disable-next-line import/first
import { validateScoringEvent, aggregatePlayers } from '../controllers/scoring.controller';

let events: any[] = [];
let format = 'knockout';
let settings: Record<string, unknown> | null = null;
let summary: Record<string, unknown> = {};
const ball = (side: 'A' | 'B', runs: number, so = 0, extra: object = {}) => ({ event_type: 'ball', payload: { team_side: side, runs, ...(so ? { super_over: so } : {}), ...extra }, created_at: '2026-10-05T10:00:00Z' });
const wkt = (side: 'A' | 'B', so = 0) => ({ event_type: 'wicket', payload: { team_side: side, wicket_type: 'bowled', ...(so ? { super_over: so } : {}) }, created_at: '2026-10-05T10:00:00Z' });
/** An over of `runs` then five dots. */
const over = (side: 'A' | 'B', runs: number, so = 0) => [ball(side, runs, so), ...Array.from({ length: 5 }, () => ball(side, 0, so))];
const setup = () => {
  mockNext = (q) => {
    if (q[0] === 'from:matches') {
      return { data: { id: MATCH, created_by: ME, umpire_id: null, scorer_id: null, status: 'live', team_a_id: TA, team_b_id: TB, sport_id: 's',
        is_ranked: false, tournament_id: 'T', round: 1, next_match_id: null, group_label: null, team_a_name: 'Lions', team_b_name: 'Tigers',
        score_summary: summary, voided_at: null, format: 'T1', overs: 1, rules: { v: 1, style: 'limited', overs: 1 }, toss_choice: null } };
    }
    if (q[0] === 'from:tournaments') return { data: { format, settings, created_by: ME } };
    if (q[0] === 'from:match_events') return { data: events, count: events.length };
    if (q[0] === 'from:match_participants') return { data: [] };
    return { data: null };
  };
};
beforeEach(() => {
  mockLog = [];
  mockSport = { slug: 'cricket', allows_draw: true };
  mockOrganiser = true;
  format = 'knockout';
  settings = null;
  // Level at 4: A batted first.
  events = [...over('A', 4), ...over('B', 4)];
  summary = { A: { runs: 4, balls: 6, wickets: 0 }, B: { runs: 4, balls: 6, wickets: 0 } };
});
const result = () => writes().map((q) => q.join()).join(' ');

describe('the shared rules', () => {
  test('a super over: the side that batted second bats first; level → the next, with the order swapped', () => {
    const evs = [...events, ...over('B', 9, 1), ...over('A', 9, 1), ...over('A', 3, 2), ball('B', 4, 2)];
    const sos = superOversOf(evs, 'A');
    expect(sos.map((s) => [s.n, s.first, s.A.runs, s.B.runs, s.done, s.winner])).toEqual([[1, 'B', 9, 9, true, null], [2, 'A', 3, 4, true, 'B']]);
    expect(sideTotals(mainEvents(evs), 'A', 10).runs).toBe(4); // the match's own innings untouched
    expect(superOverNumber({ super_over: 2 })).toBe(2);
    expect(superOverNumber({ super_over: 'x' })).toBe(0);
  });
  test('two wickets and the side is out; boundaries off the bat', () => {
    // B out for 0 in two balls; A's dot ball leaves the chase open, a single ends it.
    expect(superOversOf([...events, wkt('B', 1), wkt('B', 1), ball('A', 0, 1)], 'A')[0]).toMatchObject({ B: { wickets: 2, balls: 2 }, done: false });
    expect(superOversOf([...events, wkt('B', 1), wkt('B', 1), ball('A', 1, 1)], 'A')[0]).toMatchObject({ done: true, winner: 'A' });
    expect(boundariesOf([ball('A', 4), ball('A', 6), ball('B', 4), { event_type: 'extra', payload: { team_side: 'B', runs: 4, type: 'B' } }])).toEqual({ A: 2, B: 1 });
  });
  test('player figures leave the super over out', () => {
    const evs = [ball('A', 4, 0, { batsman_id: 'p1', bowler_id: 'b1' }), ball('A', 6, 1, { batsman_id: 'p1', bowler_id: 'b1' })];
    expect(aggregatePlayers('cricket', evs as never).p1).toMatchObject({ runs: 4, sixes: 0 });
  });
});

describe('the server takes a super over ball only on a level knockout', () => {
  const v = (payload: object) => validateScoringEvent(MATCH, { id: MATCH, status: 'live', tournament_id: 'T', team_a_id: TA, team_b_id: TB, sport_id: 's', round: 1, group_label: null, score_summary: summary } as never, { event_type: 'ball', payload: { team_side: 'B', runs: 1, ...payload } });
  test('level knockout → super over 1 accepted', async () => {
    setup();
    expect(await v({ super_over: 1 })).toBeNull();
  });
  test('not level, not a knockout, out of order, already decided, a bad number', async () => {
    setup();
    summary = { A: { runs: 5, balls: 6 }, B: { runs: 4, balls: 6 } };
    expect((await v({ super_over: 1 }))?.body.code).toBe('SUPER_OVER_NOT_ALLOWED');
    summary = { A: { runs: 4, balls: 6 }, B: { runs: 4, balls: 6 } };
    format = 'round_robin';
    expect((await v({ super_over: 1 }))?.body.code).toBe('SUPER_OVER_NOT_ALLOWED');
    format = 'knockout';
    expect((await v({ super_over: 2 }))?.body.code).toBe('SUPER_OVER_OUT_OF_ORDER');
    summary = { ...summary, super_overs: [{ n: 1, done: false, winner: null }] };
    expect((await v({ super_over: 2 }))?.body).toMatchObject({ code: 'SUPER_OVER_OUT_OF_ORDER', error: 'Finish super over 1 first.' });
    expect(await v({ super_over: 1 })).toBeNull();
    summary = { ...summary, super_overs: [{ n: 1, done: true, winner: null }] };
    expect((await v({ super_over: 1 }))?.body.code).toBe('SUPER_OVER_OUT_OF_ORDER');
    expect(await v({ super_over: 2 })).toBeNull();
    summary = { ...summary, super_overs: [{ n: 1, done: true, winner: 'B' }] };
    expect((await v({ super_over: 2 }))?.body.code).toBe('SUPER_OVER_DECIDED');
    expect((await v({ super_over: 0 }))?.body.code).toBe('BAD_SUPER_OVER');
  });
});

describe('completing a tied knockout', () => {
  test('decided by super over 1: the winner must be its winner; "Tigers won the super over (9–7)"', async () => {
    events = [...events, ...over('B', 9, 1), ...over('A', 7, 1)];
    setup();
    expect((await call({ winner_team_id: TA, winner_side: 'A' })).body.code).toBe('SUPER_OVER_WINNER_MISMATCH');
    const r = await call({ winner_team_id: TB, winner_side: 'B' });
    expect(r.statusCode).toBe(200);
    expect(result()).toContain('Tigers won the super over (9–7)');
    expect(result()).toContain('"A":{"score":4');
  });
  test('level again: not yet — "play another"; the 2nd decides it', async () => {
    events = [...events, ...over('B', 9, 1), ...over('A', 9, 1)];
    setup();
    expect((await call({ winner_team_id: TB, winner_side: 'B' })).body.code).toBe('SUPER_OVER_NOT_DECIDED');
    events = [...events, ...over('A', 3, 2), ball('B', 4, 2)];
    setup();
    const r = await call({ winner_team_id: TB, winner_side: 'B' });
    expect(r.statusCode).toBe(200);
    expect(result()).toContain('Tigers won the 2nd super over (4–3)');
  });
  test('a played tie needs a super over or the fallback; a desk result (nothing scored) still names its winner (found on the local server)', async () => {
    setup();
    expect((await call({ winner_team_id: TA, winner_side: 'A' })).body.code).toBe('SUPER_OVER_NEEDED');
    events = [];
    summary = {};
    setup();
    expect((await call({ winner_team_id: TA, winner_side: 'A' })).statusCode).toBe(200);
  });
  test('fallback: the higher seed by default, the organiser’s call', async () => {
    setup();
    expect((await call({ tie_fallback: 'toss', winner_team_id: TA, winner_side: 'A' })).body.code).toBe('TIE_FALLBACK_MISMATCH');
    mockOrganiser = false;
    expect((await call({ tie_fallback: 'seed', winner_team_id: TA, winner_side: 'A' })).body.code).toBe('TIE_FALLBACK_ORGANISER_ONLY');
    mockOrganiser = true;
    const r = await call({ tie_fallback: 'seed', winner_team_id: TA, winner_side: 'A' });
    expect(r.statusCode).toBe(200);
    expect(result()).toContain('Lions went through as the higher seed');
    expect(result()).toContain('"tie_decided_by":"seed"');
  });
  test('fallback by boundaries: counted from the match and its super overs', async () => {
    settings = { v: 1, tieFallback: 'boundaries' };
    events = [ball('A', 4), ...Array.from({ length: 5 }, () => ball('A', 0)), ball('B', 2), ball('B', 2), ...Array.from({ length: 4 }, () => ball('B', 0))];
    setup();
    expect((await call({ tie_fallback: 'boundaries', winner_team_id: TB, winner_side: 'B' })).body.code).toBe('TIE_FALLBACK_WINNER_MISMATCH');
    const r = await call({ tie_fallback: 'boundaries', winner_team_id: TA, winner_side: 'A' });
    expect(r.statusCode).toBe(200);
    expect(result()).toContain('Lions went through on boundaries (1–0)');
  });
  test('no fallback once a super over has decided it', async () => {
    events = [...events, ...over('B', 9, 1), ...over('A', 7, 1)];
    setup();
    expect((await call({ tie_fallback: 'seed', winner_team_id: TA, winner_side: 'A' })).body.code).toBe('TIE_FALLBACK_NOT_ALLOWED');
  });
});
