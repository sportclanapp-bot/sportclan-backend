/**
 * BUILD 1.5 · a drawn knockout chess game can be completed. A bracket needs a
 * winner, and nothing let the scorer name the tie-break game's winner, so the
 * fixture dead-ended. completeMatch now takes chess_tiebreak with the winner:
 * only for a drawn knockout chess game.
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
const setup = (extra: object = {}) => {
  mockNext = (q) => {
    if (q[0] === 'from:matches') {
      return { data: { id: MATCH, created_by: ME, umpire_id: null, status: 'live', team_a_id: TA, team_b_id: TB, sport_id: 's',
        is_ranked: false, tournament_id: 'T', round: 1, next_match_id: null, group_label: null, team_a_name: 'Magnus', team_b_name: 'Hikaru',
        score_summary: {}, voided_at: null, format: 'Blitz · 5+0', ...extra } };
    }
    if (q[0] === 'from:tournaments') return { data: { format } };
    if (q[0] === 'from:match_events') return { data: events, count: events.length };
    if (q[0] === 'from:match_participants') return { data: [] };
    return { data: null };
  };
};
beforeEach(() => {
  mockLog = [];
  mockSport = { slug: 'chess', allows_draw: true };
  format = 'knockout';
  events = [{ event_type: 'result', payload: { winner: 'draw', reason: 'draw_agreement' }, created_at: '2026-09-29T10:00:00Z' }];
});

describe('a drawn knockout chess game', () => {
  test('without a tie-break winner it still needs one (BRACKET_NEEDS_WINNER)', async () => {
    setup();
    const r = await call({ is_draw: true });
    expect([r.statusCode, r.body.code]).toEqual([400, 'BRACKET_NEEDS_WINNER']);
  });
  test('with chess_tiebreak and the winner it completes: "Hikaru won on tie-break"', async () => {
    setup();
    const r = await call({ winner_team_id: TB, winner_side: 'B', chess_tiebreak: true });
    expect(r.statusCode).toBe(200);
    const w = writes().map((q) => q.join()).join(' ');
    expect(w).toContain('Hikaru won on tie-break');
    expect(w).toContain('"chess_tiebreak":{"winner_side":"B"}');
  });
  test('a decisive chess game can\'t claim a tie-break', async () => {
    events = [{ event_type: 'result', payload: { winner: 'white', reason: 'checkmate' }, created_at: '2026-09-29T10:00:00Z' }];
    setup();
    const r = await call({ winner_team_id: TA, winner_side: 'A', chess_tiebreak: true });
    expect([r.statusCode, r.body.code]).toEqual([400, 'CHESS_TIEBREAK_NOT_ALLOWED']);
  });
  test('a league chess draw doesn\'t take a tie-break', async () => {
    format = 'round_robin';
    setup();
    const r = await call({ winner_team_id: TA, winner_side: 'A', chess_tiebreak: true });
    expect([r.statusCode, r.body.code]).toEqual([400, 'CHESS_TIEBREAK_NOT_ALLOWED']);
  });
  test('another sport can\'t use it', async () => {
    mockSport = { slug: 'football', allows_draw: true };
    events = [];
    setup();
    const r = await call({ winner_team_id: TA, winner_side: 'A', chess_tiebreak: true });
    expect([r.statusCode, r.body.code]).toEqual([400, 'CHESS_TIEBREAK_NOT_ALLOWED']);
  });
});
