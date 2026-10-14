/**
 * N-INV1-R2-1 (launch test plan, Round 2): a cricket best-of-3 that is 1–1 after its last game
 * (one game 'no result') could never be ended — the server refused 'the series isn't decided'
 * and there was no next game. Once every game is played the series is settled: the side with
 * more games (1–0 after two no-results), or a drawn series; a knockout's level series goes to
 * the side the organiser names (the tournament's way).
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
let format = 'knockout';
const over = (side: 'A' | 'B', runs: number) => [
  { event_type: 'ball', payload: { team_side: side, runs }, created_at: `2026-09-29T10:0${side === 'A' ? 0 : 1}:00Z` },
  ...Array.from({ length: 5 }, () => ({ event_type: 'ball', payload: { team_side: side, runs: 0 }, created_at: `2026-09-29T10:0${side === 'A' ? 0 : 1}:30Z` })),
];
let storedSummary: Record<string, unknown> = {};
const setup = () => {
  mockNext = (q) => {
    if (q[0] === 'from:matches') {
      return { data: { id: MATCH, created_by: ME, umpire_id: null, status: 'live', team_a_id: TA, team_b_id: TB, sport_id: 's',
        is_ranked: false, tournament_id: 'T', round: 1, next_match_id: null, group_label: null, team_a_name: 'Lions', team_b_name: 'Tigers',
        score_summary: storedSummary, voided_at: null, format: 'T1', overs: 1, rules: seriesRules, toss_choice: null } };
    }
    if (q[0] === 'from:tournaments') return { data: { format } };
    if (q[0] === 'from:match_events') return { data: events, count: events.length };
    if (q[0] === 'from:match_participants') return { data: [] };
    return { data: null };
  };
};
beforeEach(() => {
  mockLog = [];
  storedSummary = {};
  mockSport = { slug: 'cricket', allows_draw: true };
  format = 'knockout';
  events = [...over('A', 4), ...over('B', 4)];
});


import { seriesSpec } from '../utils/tieCore';
let seriesRules: Record<string, unknown> = { v: 1, style: 'limited', overs: 1, tie: seriesSpec(3) };
const gameEnd = (game: number, winner: 'A' | 'B' | null) => ({ event_type: 'note', payload: { kind: 'game_end', game, winner }, created_at: `2026-09-29T11:0${game}:00Z` });
const game = (g: number) => [...over('A', 4), ...over('B', g === 1 ? 2 : 6)].map((e) => ({ ...e, payload: { ...e.payload, game: g } }));
const series = (w: Array<'A' | 'B' | null>) => w.flatMap((x, i) => [...game(i + 1), gameEnd(i + 1, x)]);

describe('N-INV1-R2-1 · a series whose games are all played', () => {
  test('casual, 1–1 with a no result: ends as a drawn series', async () => {
    format = 'round_robin'; events = series(['A', null, 'B']);
    setup();
    mockNext = ((prev) => (q: string[]) => (q[0] === 'from:matches' ? { data: { ...(prev(q).data as object), tournament_id: null, round: null } } : prev(q)))(mockNext);
    const r = await call({});
    expect(r.statusCode).toBe(200);
    const w = writes().map((q) => q.join()).join(' ');
    expect(w).toContain('Series drawn 1–1');
    expect(w).toContain('"result_type":"draw"');
    expect(w).not.toMatch(/"winner_side":"[AB]"/);
  });
  test('1–0 after two no results: the side with more games wins it', async () => {
    format = 'round_robin'; events = series(['A', null, null]);
    setup();
    const r = await call({ winner_team_id: TA, winner_side: 'A' });
    expect(r.statusCode).toBe(200);
    expect(writes().map((q) => q.join()).join(' ')).toContain('Lions won the series 1–0');
  });
  test('a knockout level series: the organiser names who goes through; nobody else can', async () => {
    format = 'knockout'; events = series(['A', null, 'B']);
    setup();
    expect((await call({})).body.code).toBe('BRACKET_NEEDS_WINNER');
    mockOrganiser = false;
    expect((await call({ winner_team_id: TB, winner_side: 'B' })).body.code).toBe('SERIES_LEVEL_ORGANISER_ONLY');
    mockOrganiser = true;
    const r = await call({ winner_team_id: TB, winner_side: 'B' });
    expect(r.statusCode).toBe(200);
    expect(writes().map((q) => q.join()).join(' ')).toContain('Tigers go through — the series ended level 1–1');
    mockOrganiser = false;
  });
  test('not before the last game', async () => {
    format = 'round_robin'; events = series(['A', null]);
    setup();
    expect((await call({})).body.code).toBe('SERIES_NOT_DECIDED');
  });
});
