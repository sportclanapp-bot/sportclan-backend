/**
 * Phase 4 · K1-57 (69c98cc) SC-74 — a RANKED 1v1 / singles match can be
 * completed: the lineup rule is "no empty side", not "two a side".
 * Mocking as phase3MatchesB05: every `from()` is its own query → mockNext(q).
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
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => mockBlocked) }));
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  canOfficiateMatch: jest.fn(async () => true),
  isTournamentOrganiser: jest.fn(async () => true),
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
const complete = async (parts: Array<{ user_id: string; team_side: string }>) => {
  mockNext = (q) => {
    if (q[0] === 'from:matches') {
      return { data: { id: MATCH, created_by: ME, umpire_id: null, status: 'live', team_a_id: null, team_b_id: null, sport_id: 's-chess', is_ranked: true, tournament_id: null, team_a_name: 'Me', team_b_name: 'You', score_summary: {}, voided_at: null } };
    }
    if (q[0] === 'from:match_participants') return { data: parts };
    return { data: null };
  };
  const r = res();
  await completeMatch({ userId: ME, params: { id: MATCH }, query: {}, body: { winner_side: 'A' }, headers: { 'x-device-id': 'dev-1' }, get: () => 'dev-1', header: () => 'dev-1' } as any, r);
  return r;
};

beforeEach(() => { mockLog = []; mockPending = false; mockBlocked = new Set(); });

describe('SC-74 · ranked completion lineup rule', () => {
  it('K1-57 (69c98cc): one registered player a side (1v1) passes the lineup guard', async () => {
    const r = await complete([{ user_id: ME, team_side: 'A' }, { user_id: P2, team_side: 'B' }]);
    expect(r.body?.error).not.toBe(GUARD);
    expect(r.statusCode).not.toBe(400);
  });
  it('K1-57 (69c98cc): an empty side is still refused (no phantom-rating farming)', async () => {
    const r = await complete([{ user_id: ME, team_side: 'A' }]);
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe(GUARD);
  });
});
