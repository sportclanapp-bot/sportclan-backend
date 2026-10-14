/**
 * F183 (launch test plan, Round 2): a hockey match whose rules say no draws could still be finished
 * level as a 'Draw' through the server (only football was refused), so a no-draw league could get
 * hockey draws in its table. Hockey is refused too — it goes to a shoot-out.
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
        score_summary: storedSummary, voided_at: null, format: 'T1', overs: 1, rules: mockRules, toss_choice: null } };
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


let mockRules: Record<string, unknown> = {};
const level = [
  { event_type: 'score', payload: { team_side: 'A', value: 1 }, created_at: '2026-09-29T10:00:00Z' },
  { event_type: 'score', payload: { team_side: 'B', value: 1 }, created_at: '2026-09-29T10:10:00Z' },
];
describe('F183 · a no-draw match ended level', () => {
  it.each([['hockey', 'This match can’t end level — decide it in a shoot-out.'], ['football', 'This match can’t end level — decide it on penalties.']])('%s is refused', async (sport, words) => {
    mockSport = { slug: sport, allows_draw: true }; format = 'round_robin'; events = level; mockRules = { v: 1, drawAllowed: false };
    setup();
    const r = await call({ is_draw: true });
    expect([r.statusCode, r.body.code, r.body.error]).toEqual([400, 'DRAW_NOT_ALLOWED', words]);
  });
  test('a hockey match that allows draws still ends level', async () => {
    mockSport = { slug: 'hockey', allows_draw: true }; format = 'round_robin'; events = level; mockRules = { v: 1, drawAllowed: true };
    setup();
    expect((await call({ is_draw: true })).statusCode).toBe(200);
  });
});
