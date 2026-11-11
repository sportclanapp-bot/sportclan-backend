/**
 * N-R7-S142 (Step 2 B12, SCR-M-F05): a hockey hand-off carried the scorer's goal, the
 * shoot-out and the result. The scorer, back online, re-sent the same goal (same key) and was
 * refused 409 'The shoot-out has started…' — the check ran against the match as it is NOW,
 * before asking whether the server already had that action — so its queue stopped and its
 * match end never went. An action the server already has is answered as recorded; a NEW goal
 * during the shoot-out is still refused (IN_SHOOTOUT).
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
let mockSlug = 'hockey';
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
    return { data: { id: MID, created_by: ME, status: 'live', sport_id: 's-hockey', score_summary: {}, team_a_id: null, team_b_id: null, team_a_name: 'Tigers', team_b_name: 'Lions', is_ranked: false, tournament_id: null, voided_at: null, format: null } };
  }
  if (q[0] === 'from:match_events' && q.some((c) => c.includes('client_key'))) return { data: had ? { id: 'e-had', event_type: 'score' } : null };
  if (q[0] === 'from:match_events' && q.some((c) => c.includes('"note"'))) return { data: [{ event_type: 'note', payload: { kind: 'shootout_start' } }] };
  return { data: null };
};
const goal = { event_type: 'score', payload: { team_side: 'A', kind: 'goal', value: 1 }, idempotency_key: KEY };
test('shoot-out on: the goal a hand-off already delivered (same key) is answered as recorded', async () => {
  mockNext = world(true);
  const r = await call(goal);
  expect([r.statusCode, r.body?.replayed]).toEqual([200, true]);
});
test('shoot-out on: a NEW goal is still refused IN_SHOOTOUT', async () => {
  mockNext = world(false);
  const r = await call(goal);
  expect([r.statusCode, r.body?.code]).toEqual([409, 'IN_SHOOTOUT']);
});
test('shoot-out on: a goal without a key is refused too', async () => {
  mockNext = world(true);
  const r = await call({ ...goal, idempotency_key: undefined });
  expect([r.statusCode, r.body?.code]).toEqual([409, 'IN_SHOOTOUT']);
});
