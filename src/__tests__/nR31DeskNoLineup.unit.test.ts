/**
 * N-R3-1 (launch test plan, Round 3, found on the phone): a result the organiser recorded at the venue desk
 * (the offline hub) was refused for a ranked tournament fixture — 'Set the lineup first' — though nobody can
 * set a line-up at a desk with no signal. The desk's own record (desk: true, a tournament organiser) goes
 * through like the fixture editor's, and with no line-up moves nobody's rating.
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
let mockOrganiser = true;
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => mockBlocked) }));
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  canOfficiateMatch: jest.fn(async () => true),
  isTournamentOrganiser: jest.fn(async () => mockOrganiser),
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
  getSport: jest.fn(async () => ({ slug: 'chess', allows_draw: true })),
}));

// eslint-disable-next-line import/first
import { completeMatch } from '../controllers/matches.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const MATCH = '22222222-2222-4222-8222-222222222222';
const P2 = '55555555-5555-4555-8555-555555555555';
const GUARD = 'Ranked matches need at least one registered player on each side. Set the lineup first.';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const T = '33333333-3333-4333-8333-333333333333';
const complete = async (body: object) => {
  mockNext = (q) => {
    if (q[0] === 'from:matches') {
      return { data: { id: MATCH, created_by: 'org', umpire_id: null, status: 'scheduled', team_a_id: 'ta', team_b_id: 'tb', sport_id: 's-chess', is_ranked: true, tournament_id: T, team_a_name: 'A', team_b_name: 'B', score_summary: {}, voided_at: null } };
    }
    if (q[0] === 'from:match_participants') return { data: [] };
    return { data: null };
  };
  const r = res();
  await completeMatch({ userId: ME, params: { id: MATCH }, query: {}, body, headers: { 'x-device-id': 'dev-1' }, get: () => 'dev-1', header: () => 'dev-1' } as any, r);
  return r;
};
beforeEach(() => { mockLog = []; mockOrganiser = true; });
test('the organiser’s desk result goes through, rating nobody', async () => {
  const r = await complete({ winner_team_id: 'ta', desk: true });
  expect([r.statusCode, r.body?.error]).toEqual([200, undefined]);
  expect(mockLog.some((q) => q[0] === 'from:user_sport_profiles')).toBe(false);
});
test('without the desk flag, or not an organiser: still refused', async () => {
  expect((await complete({ winner_team_id: 'ta' })).body?.error).toBe(GUARD);
  mockOrganiser = false;
  expect((await complete({ winner_team_id: 'ta', desk: true })).body?.error).toBe(GUARD);
});
