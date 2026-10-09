/**
 * Phase 4 · K2 — regression tests for the backend scoring fixes (see the app
 * repo's phase4/K2.md). Supabase is mocked: every `from()` starts its own
 * query, resolved by `mockNext(q)`; `rpc()` calls resolve through `mockRpc`.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
let mockRpcCalls: Array<[string, Record<string, unknown>]> = [];
let mockRpc: (name: string, args: Record<string, unknown>) => { data?: unknown; error?: unknown } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'range', 'gt', 'gte', 'lt', 'lte', 'upsert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return {
    supabase: {
      from: jest.fn(start),
      rpc: jest.fn(async (name: string, args: Record<string, unknown>) => {
        mockRpcCalls.push([name, args]);
        return { data: null, error: null, ...mockRpc(name, args) };
      }),
    },
  };
});
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), canOfficiateMatch: jest.fn(async () => true) }));
jest.mock('../utils/scoringLease', () => ({ ...jest.requireActual('../utils/scoringLease'), checkLease: jest.fn(async () => ({ ok: true })) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), isSportInactive: jest.fn(async () => false) }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'cricket' })) }));
jest.mock('../utils/singles', () => ({ ...jest.requireActual('../utils/singles'), pendingRankedOpponent: jest.fn(async () => ({ pending: false, opponentName: null })) }));
const mockNotifyUsers = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../utils/notify', () => ({ notifyUsers: (...a: unknown[]) => mockNotifyUsers(...a) }));

// eslint-disable-next-line import/first
import { createEvent, recordEventIdempotent, validateScoringEvent } from '../controllers/scoring.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const MATCH = '22222222-2222-4222-8222-222222222222';
const FAN = '33333333-3333-4333-8333-333333333333';
const KEY = '44444444-4444-4444-8444-444444444444';
const matchRow = { id: MATCH, created_by: ME, umpire_id: null, score_summary: {}, sport_id: 'cricket', status: 'live', is_ranked: false, tournament_id: null, voided_at: null, team_a_id: null, team_b_id: null, team_a_name: 'A', team_b_name: 'B' };
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn(), on: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => {
  const r = res();
  await fn({ userId: ME, params: { matchId: MATCH }, query: {}, body: {}, headers: { 'x-device-id': 'dev-1' }, get: () => 'dev-1', header: () => 'dev-1', ...req }, r);
  return r;
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const world = (q: Q) => {
  if (q[0] === 'from:matches') return { data: matchRow };
  if (q[0] === 'from:match_participants' || q[0] === 'from:match_followers') return { data: [{ user_id: FAN }] };
  return { data: [] };
};
const wicket = { event_type: 'wicket', payload: { team_side: 'A', wicket_type: 'bowled' } };

beforeEach(() => {
  mockLog = [];
  mockRpcCalls = [];
  mockNext = world;
  mockRpc = () => ({ data: { event: { id: 'e1' }, was_new: true } });
  mockNotifyUsers.mockReset();
  mockNotifyUsers.mockImplementation(async () => undefined);
  jest.restoreAllMocks();
});

describe('K2-5b · a failed score fan-out is logged (SC-112)', () => {
  it('K2-5b (e73f9e8): notifyUsers throwing inside fanoutScoreUpdate → console.error, event still 200', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockNotifyUsers.mockImplementation(async () => { throw new Error('push down'); });
    const r = await call(createEvent, { body: wicket });
    await flush();
    expect(r.statusCode).toBe(200);
    expect(err).toHaveBeenCalledWith('[fanout-score-update] failed:', 'push down');
  });
});

describe('K2-9 · events go through the atomic record_match_event RPC (SC-113)', () => {
  it('K2-9 (dee84f7): createEvent records via the RPC, not a direct match_events insert', async () => {
    const r = await call(createEvent, { body: wicket });
    expect(r.statusCode).toBe(200);
    expect(mockRpcCalls.map(([n]) => n)).toContain('record_match_event');
    expect(mockLog.filter((q) => q[0] === 'from:match_events' && q.some((c) => c.startsWith('insert:')))).toHaveLength(0);
  });
  it('K2-9 (dee84f7): only when the RPC is missing (PGRST202) does it fall back to the direct insert', async () => {
    mockRpc = () => ({ data: null, error: { code: 'PGRST202', message: 'no function' } });
    mockNext = (q) => (q[0] === 'from:match_events' && q.some((c) => c.startsWith('insert:')) ? { data: { id: 'e2' } } : world(q));
    const out = await recordEventIdempotent({ matchId: MATCH, createdBy: ME, eventType: 'ball', payload: { runs: 1 } });
    expect(out.event).toEqual({ id: 'e2' });
    expect(mockLog.filter((q) => q[0] === 'from:match_events' && q.some((c) => c.startsWith('insert:')))).toHaveLength(1);
  });
  it('K2-9 (dee84f7): any other RPC error is a failure, never a silent second insert', async () => {
    mockRpc = () => ({ data: null, error: { code: '40001', message: 'serialization' } });
    const out = await recordEventIdempotent({ matchId: MATCH, createdBy: ME, eventType: 'ball' });
    expect(out.error).toBeTruthy();
    expect(mockLog.filter((q) => q[0] === 'from:match_events')).toHaveLength(0);
  });
});

describe('K2-19 · the scorer’s idempotency key reaches the RPC (SC-129)', () => {
  it('K2-19 (a3ddf8b): createEvent passes idempotency_key as p_client_key', async () => {
    await call(createEvent, { body: { ...wicket, idempotency_key: KEY } });
    const [, args] = mockRpcCalls.find(([n]) => n === 'record_match_event')!;
    expect(args.p_client_key).toBe(KEY);
  });
  it('K2-19 (a3ddf8b): an 8-arg PGRST202 retries the 7-arg RPC before any direct insert', async () => {
    mockRpc = (_n, args) => ('p_client_key' in args ? { error: { code: 'PGRST202' } } : { data: { id: 'e3' } });
    const out = await recordEventIdempotent({ matchId: MATCH, createdBy: ME, eventType: 'ball', clientKey: KEY });
    expect(mockRpcCalls).toHaveLength(2);
    expect('p_client_key' in mockRpcCalls[1][1]).toBe(false);
    expect(out.event).toEqual({ id: 'e3' });
    expect(mockLog.filter((q) => q[0] === 'from:match_events')).toHaveLength(0);
  });
});

describe('K2-21 · score fan-out carries the scorer as actorId (SC-135)', () => {
  it('K2-21a (89ce746): notifyUsers gets { actorId: scorer } so self/blocked are skipped', async () => {
    await call(createEvent, { body: wicket });
    await flush();
    expect(mockNotifyUsers).toHaveBeenCalledTimes(1);
    expect(mockNotifyUsers.mock.calls[0][2]).toEqual({ actorId: ME });
  });
});

describe('K2-22 · a deduplicated event does not notify again (SC-133)', () => {
  it('K2-22 (0ed4e42): was_new=false → no fan-out; was_new=true → one', async () => {
    mockRpc = () => ({ data: { event: { id: 'e1' }, was_new: false } });
    await call(createEvent, { body: wicket });
    await flush();
    expect(mockNotifyUsers).not.toHaveBeenCalled();
    mockRpc = () => ({ data: { event: { id: 'e1' }, was_new: true } });
    await call(createEvent, { body: wicket });
    await flush();
    expect(mockNotifyUsers).toHaveBeenCalledTimes(1);
  });
  it('K2-22 (0ed4e42): the jsonb {event, was_new} shape is unwrapped; a bare row counts as new', async () => {
    mockRpc = () => ({ data: { event: { id: 'e9' }, was_new: false } });
    expect(await recordEventIdempotent({ matchId: MATCH, createdBy: ME, eventType: 'ball' })).toEqual({ event: { id: 'e9' }, error: null, wasNew: false });
    mockRpc = () => ({ data: { id: 'e8' } });
    expect((await recordEventIdempotent({ matchId: MATCH, createdBy: ME, eventType: 'ball' })).wasNew).toBe(true);
  });
});

describe('K2-39a · scoring inputs are range-checked (SC-228)', () => {
  const m = { id: MATCH, status: 'live', is_ranked: false };
  it.each([
    // Stage 13 · CR3: period and clock have no top — 0 or more, whole.
    ['period -1', { event_type: 'score', period: -1, payload: { team_side: 'A', value: 1 } }, 'period must be a whole number, 0 or more'],
    ['period 1.5', { event_type: 'score', period: 1.5, payload: { team_side: 'A', value: 1 } }, 'period must be a whole number, 0 or more'],
    ['clock -1', { event_type: 'score', clock_seconds: -1, payload: { team_side: 'A', value: 1 } }, 'clock_seconds must be a whole number, 0 or more'],
    ['clock 1.5', { event_type: 'score', clock_seconds: 1.5, payload: { team_side: 'A', value: 1 } }, 'clock_seconds must be a whole number, 0 or more'],
    ['value 4', { event_type: 'score', payload: { team_side: 'A', value: 4 } }, 'value must be an integer between 1 and 3'],
    ['value -2', { event_type: 'score', payload: { team_side: 'A', value: -2 } }, 'value must be an integer between 1 and 3'],
    ['runs -1', { event_type: 'ball', payload: { team_side: 'A', runs: -1 } }, 'runs must be a whole number, 0 or more'],
    ['runs 2.5', { event_type: 'ball', payload: { team_side: 'A', runs: 2.5 } }, 'runs must be a whole number, 0 or more'],
  ])('K2-39a (e2a1101): %s → 400', async (_n, ev, error) => {
    const out = await validateScoringEvent(MATCH, m, ev as any);
    expect(out).toEqual({ status: 400, body: { error } });
  });
  it('K2-39a (e2a1101): in-range values pass', async () => {
    expect(await validateScoringEvent(MATCH, m, { event_type: 'score', period: 2, clock_seconds: 600, payload: { team_side: 'B', value: 3 } })).toBeNull();
    // Stage 13 · CR3: the old tops (period 2000, clock 86400, runs 7) and above pass.
    expect(await validateScoringEvent(MATCH, m, { event_type: 'score', period: 2001, clock_seconds: 86401, payload: { team_side: 'B', value: 1 } })).toBeNull();
    expect(await validateScoringEvent(MATCH, m, { event_type: 'ball', payload: { team_side: 'A', runs: 8 } })).toBeNull();
  });
});
