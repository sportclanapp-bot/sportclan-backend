/**
 * N-R3-4 (launch test plan, Round 3, found on the phone): after a QR hand-off carried a scorer's actions
 * and the result, the scorer's phone sent the same actions and was refused (match finished) — "this match
 * was ended on another phone; 3 actions weren't sent", though they were. An action the server already has
 * is answered as already recorded, finished or not; a new action on a finished match is still refused.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
let mockRpc: (name: string, args: any) => { data?: unknown; error?: unknown } = () => ({ data: null, error: null });
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
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async (n: string, a: any) => ({ data: null, error: null, ...mockRpc(n, a) })) } };
});
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), canOfficiateMatch: jest.fn(async () => true) }));
jest.mock('../utils/scoringLease', () => ({ ...jest.requireActual('../utils/scoringLease'), checkLease: jest.fn(async () => ({ ok: true })) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), isSportInactive: jest.fn(async () => false) }));
jest.mock('../utils/singles', () => ({ ...jest.requireActual('../utils/singles'), pendingRankedOpponent: jest.fn(async () => ({ pending: false, opponentName: null })) }));
let mockSlug = 'football';
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: mockSlug })) }));
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(async () => undefined), notifyUser: jest.fn() }));

// eslint-disable-next-line import/first
import { createEvent } from '../controllers/scoring.controller';
const ME = '11111111-1111-4111-8111-111111111111';
const MID = '22222222-2222-4222-8222-222222222222';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (body: object) => {
  const r = res();
  await createEvent({ userId: ME, params: { matchId: MID }, query: {}, body, headers: {}, get: () => undefined, header: () => undefined } as any, r);
  return r;
};
const KEY = '33333333-3333-4333-8333-333333333333';
const world = (had: boolean) => (q: Q) => {
  if (q[0] === 'from:matches' && q.some((c) => c.startsWith('maybeSingle'))) {
    return { data: { id: MID, created_by: ME, status: 'completed', sport_id: 's-foot', score_summary: {}, team_a_id: null, team_b_id: null, team_a_name: 'Reds', team_b_name: 'Blues', is_ranked: false, tournament_id: null, voided_at: null, format: null } };
  }
  if (q[0] === 'from:match_events' && q.some((c) => c.includes('client_key'))) return { data: had ? { id: 'e-had', event_type: 'score' } : null };
  return { data: null };
};
test('an action it already has: already recorded, nothing written', async () => {
  mockNext = world(true);
  const r = await call({ event_type: 'score', payload: { team_side: 'A', kind: 'goal', value: 1 }, idempotency_key: KEY });
  expect([r.statusCode, r.body?.replayed, r.body?.event?.id]).toEqual([200, true, 'e-had']);
  expect(mockLog.some((q) => q.some((c) => /^(insert|update):/.test(c)))).toBe(false);
});
test('a new action on a finished match: still MATCH_FINISHED', async () => {
  mockNext = world(false);
  const r = await call({ event_type: 'score', payload: { team_side: 'A', kind: 'goal', value: 1 }, idempotency_key: KEY });
  expect([r.statusCode, r.body.code]).toEqual([409, 'MATCH_FINISHED']);
});
