/**
 * Phase 4 · K1 (rows K1-38d, K1-40a, K1-46a) — createEvent: every sport's
 * scoring event reaches followers (not just cricket wickets), a finished match
 * takes no more events; recomputeSummary reads the chess result event.
 * Supabase is mocked: each from() is its own query → mockNext(q); rpc → mockRpc.
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
import { createEvent, recomputeSummary } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { notifyUsers } from '../utils/notify';

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
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const notify = notifyUsers as jest.Mock;

beforeEach(() => {
  mockLog = []; notify.mockClear(); mockSlug = 'football';
  mockRpc = (n) => (n === 'record_match_event' ? { data: { event: { id: 'e1' }, was_new: true } } : { data: null });
});

describe('K1-38d (5bb2119) · SC-34 score notifications for every sport', () => {
  const world = (summary: object, status = 'live') => (q: Q) => {
    if (q[0] === 'from:matches' && q.some((c) => c.startsWith('maybeSingle'))) {
      return { data: { id: MID, created_by: ME, status, sport_id: 's-foot', score_summary: summary, team_a_id: null, team_b_id: null, team_a_name: 'Reds', team_b_name: 'Blues', is_ranked: false, tournament_id: null, voided_at: null, format: null } };
    }
    if (q[0] === 'from:match_participants' || q[0] === 'from:match_followers') return { data: [{ user_id: 'fan-1' }] };
    if (q[0] === 'from:match_events') return { data: [{ event_type: 'score', payload: { team_side: 'A', kind: 'goal' } }] };
    return { data: null };
  };
  it('K1-38d (5bb2119): a football goal (event_type "score") notifies the match\'s people', async () => {
    mockNext = world({ A: { score: 0 }, B: { score: 0 } });
    const r = await call({ event_type: 'score', payload: { team_side: 'A', kind: 'goal', value: 1 } });
    expect(r.statusCode).toBe(200);
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    const [ids, n] = notify.mock.calls[0];
    expect(ids).toEqual(['fan-1']);
    expect(n.type).toBe('score_update');
    expect(n.title).toBe('GOAL!');
    expect(n.body).toContain('Reds');
  });
  it('K1-40a (41618ad): a scoring event on a completed match → 409 MATCH_FINISHED, nothing recorded', async () => {
    mockNext = world({}, 'completed');
    const r = await call({ event_type: 'score', payload: { team_side: 'A', kind: 'goal', value: 1 } });
    expect([r.statusCode, r.body.code]).toEqual([409, 'MATCH_FINISHED']);
    expect(mockLog.some((q) => q.some((c) => /^(insert|update):/.test(c)))).toBe(false);
  });
});

describe('K1-46a (214d4d9) · SC-47 the chess result event decides the summary', () => {
  const run = async (events: object[]) => {
    mockSlug = 'chess';
    mockNext = (q) => {
      if (q[0] === 'from:matches' && q.some((c) => c.startsWith('maybeSingle'))) return { data: { sport_id: 's-chess', score_summary: {}, format: null } };
      if (q[0] === 'from:match_events') return { data: events };
      return { data: null };
    };
    return recomputeSummary(MID);
  };
  it.each([
    ['white', 1, 0, 'White wins', 'A'],
    ['black', 0, 1, 'Black wins', 'B'],
    ['draw', 0.5, 0.5, 'Draw', 'tie'],
  ])('K1-46a (214d4d9): winner %s → %d-%d, "%s", winner_side %s', async (winner, a, b, result, side) => {
    const s = await run([{ event_type: 'result', payload: { winner, reason: winner === 'draw' ? 'draw_agreement' : 'checkmate' } }]);
    expect(s!.A.score).toBe(a);
    expect(s!.B.score).toBe(b);
    expect(s!.result).toBe(result);
    expect(s!.winner_side).toBe(side);
  });
  it('K1-46a (214d4d9): the last result event wins', async () => {
    const s = await run([
      { event_type: 'result', payload: { winner: 'white' } },
      { event_type: 'result', payload: { winner: 'black' } },
    ]);
    expect(s!.winner_side).toBe('B');
  });
});
