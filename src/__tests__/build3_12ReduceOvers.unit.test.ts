/**
 * BUILD 3.12 · reduce overs mid-match: both sides get the same, fewer overs
 * (an equal cut; a chase-only cut is DLS). The match's own overs change, so
 * every reader follows; the original is kept as score_summary.overs_reduced.
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
import { reduceOvers } from '../controllers/matchFeatures.controller';
// eslint-disable-next-line import/first
import { reduceOversRefusal, oversReducedFrom } from '../utils/cricketRules';

const ME = '11111111-1111-4111-8111-111111111111';
const MATCH = '22222222-2222-4222-8222-222222222222';
const TA = '44444444-4444-4444-8444-444444444444';
const TB = '55555555-5555-4555-8555-555555555555';
const call = async (body: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await reduceOvers({ userId: ME, params: { id: MATCH }, query: {}, body, headers: {}, get: () => undefined, header: () => undefined } as any, r);
  return r;
};
const writes = () => mockLog.filter((q) => q.some((c) => /^(update|upsert):/.test(c)));
let events: unknown[] = [];
let summary: Record<string, unknown> = {};
let rules: Record<string, unknown> = { v: 1, style: 'limited', overs: 10 };
const setup = () => {
  mockNext = (q) => {
    if (q[0] === 'from:matches') {
      return { data: { id: MATCH, created_by: ME, umpire_id: null, status: 'live', tournament_id: null, sport_id: 's',
        format: `T${String(rules.overs)}`, overs: rules.overs, rules, score_summary: summary, toss_choice: null } };
    }
    if (q[0] === 'from:match_participants') return { data: [] };
    return { data: null };
  };
};
beforeEach(() => {
  mockLog = [];
  mockSport = { slug: 'cricket', allows_draw: true };
  rules = { v: 1, style: 'limited', overs: 10 };
  summary = { first_batting_side: 'A', A: { runs: 40, wickets: 2, balls: 30 }, B: { runs: 0, wickets: 0, balls: 0 } };
});

test('the rule', () => {
  const r = (to: unknown, firstBalls: number, firstDone: boolean, chaseBalls = 0) => reduceOversRefusal({ from: 10, to, firstBalls, firstDone, chaseBalls });
  expect(r(8, 30, false)).toBeNull();
  expect(r(5, 30, false)).toBeNull(); // the first innings ends at the cut
  expect(r(4, 30, false)).toBe('More than 4 overs have been bowled already — reduce to 5 or more.');
  expect(r(10, 0, false)).toBe('Reduce to a whole number of overs below 10.');
  expect(r(7.5, 0, false)).toBe('Reduce to a whole number of overs below 10.');
  expect(r(8, 60, true, 12)).toBe('The first innings already had more than 8 overs. Both sides must get the same — cut the chase with the DLS calculator instead.');
  expect(r(8, 40, true, 12)).toBeNull(); // all out in 6.4
  expect(r(1, 0, false, 0)).toBeNull();
  expect(oversReducedFrom({ overs_reduced: { from: 10, to: 8 } })).toBe(10);
  expect(oversReducedFrom({})).toBeNull();
});
test('10 → 8 in the first innings: rules, overs, format and the record', async () => {
  setup();
  const r = await call({ overs: 8 });
  expect(r.statusCode).toBe(200);
  expect(r.body).toMatchObject({ overs: 8, from: 10, format: 'T8' });
  const w = writes().map((q) => q.join()).join(' ');
  expect(w).toContain('"overs":8,"format":"T8"');
  expect(w).toContain('"overs_reduced":{"from":10,"to":8}');
});
test('a second cut keeps the original', async () => {
  summary = { ...summary, overs_reduced: { from: 10, to: 8 } };
  rules = { v: 1, style: 'limited', overs: 8 };
  setup();
  const r = await call({ overs: 6 });
  expect(r.body).toMatchObject({ overs: 6, from: 10 });
});
test('refused: below what was bowled, a chase-only cut, not fewer, not cricket', async () => {
  setup();
  expect((await call({ overs: 4 })).body.code).toBe('BAD_REDUCE_OVERS');
  summary = { first_batting_side: 'A', A: { runs: 80, wickets: 3, balls: 60 }, B: { runs: 10, wickets: 0, balls: 6 } };
  expect((await call({ overs: 8 })).body.error).toMatch(/DLS/);
  expect((await call({ overs: 12 })).body.code).toBe('BAD_REDUCE_OVERS');
  mockSport = { slug: 'football', allows_draw: true };
  expect((await call({ overs: 8 })).body.code).toBe('NOT_CRICKET');
});
test('a max overs per bowler above the new overs comes down with them', async () => {
  rules = { v: 1, style: 'limited', overs: 10, bowlerOvers: 4, powerplayOvers: 6 };
  summary = { A: { balls: 0 }, B: { balls: 0 } };
  setup();
  const r = await call({ overs: 3 });
  expect(r.body.rules.bowlerOvers).toBe(3);
  expect(r.body.rules.powerplayOvers).toBe(3); // BUILD 3.13
});
