/**
 * Phase 4 · K2 — regression tests for the event edit / delete routes in
 * matchFeatures.controller (SC-319, see the app repo's phase4/K2.md).
 * Supabase is mocked: every `from()` starts its own query, resolved by
 * `mockNext(q)`.
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
let mockCanOfficiate = true;
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), canOfficiateMatch: jest.fn(async () => mockCanOfficiate) }));
jest.mock('../utils/scoringLease', () => ({ ...jest.requireActual('../utils/scoringLease'), checkLease: jest.fn(async () => ({ ok: true })) }));
jest.mock('../utils/scoringAudit', () => ({
  ...jest.requireActual('../utils/scoringAudit'),
  logEventEdit: jest.fn(async () => ({ auditId: 'a1' })),
  logThenDeleteEvent: jest.fn(async () => ({ auditId: 'a2' })),
  recordScoreAfter: jest.fn(async () => undefined),
}));
const mockRecompute = jest.fn(async (..._a: unknown[]) => ({ A: { runs: 5 } }));
jest.mock('../controllers/scoring.controller', () => ({ ...jest.requireActual('../controllers/scoring.controller'), recomputeSummary: (...a: unknown[]) => mockRecompute(...a) }));

// eslint-disable-next-line import/first
import { editMatchEvent, deleteMatchEvent } from '../controllers/matchFeatures.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const MATCH = '22222222-2222-4222-8222-222222222222';
const EV = '33333333-3333-4333-8333-333333333333';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => {
  const r = res();
  await fn({ userId: ME, params: { id: MATCH }, query: {}, body: {}, headers: { 'x-device-id': 'dev-1' }, get: () => 'dev-1', header: () => 'dev-1', ...req }, r);
  return r;
};
const world = (q: Q) => (q[0] === 'from:matches' ? { data: { created_by: 'someone-else', umpire_id: null, tournament_id: 't1', status: 'live' } }
  : q[0] === 'from:match_events' ? { data: { id: EV, match_id: MATCH, payload: { runs: 1 }, event_type: 'ball' } } : { data: null });

beforeEach(() => { mockLog = []; mockNext = world; mockCanOfficiate = true; mockRecompute.mockClear(); });

describe('K2-71 · editing or deleting an event rebuilds the score at once (SC-319)', () => {
  it('K2-71a (4ede7dc): edit → recomputeSummary(match) and the fresh summary is returned', async () => {
    const r = await call(editMatchEvent, { body: { event_id: EV, changes: { runs: 4 } } });
    expect(mockRecompute).toHaveBeenCalledWith(MATCH);
    expect(r.body.score_summary).toEqual({ A: { runs: 5 } });
  });
  it('K2-71a (4ede7dc): delete → recomputeSummary(match) and the fresh summary is returned', async () => {
    const r = await call(deleteMatchEvent, { body: { event_id: EV }, params: { id: MATCH, eventId: EV } });
    expect(mockRecompute.mock.calls[0][0]).toBe(MATCH);
    expect(r.body.score_summary).toEqual({ A: { runs: 5 } });
  });
  it('K2-71b (4ede7dc): the gate is canOfficiateMatch — a tournament organiser (not creator/umpire) may edit; others 403', async () => {
    expect((await call(editMatchEvent, { body: { event_id: EV, changes: { runs: 4 } } })).statusCode).toBe(200);
    mockCanOfficiate = false;
    expect((await call(editMatchEvent, { body: { event_id: EV, changes: { runs: 4 } } })).statusCode).toBe(403);
  });
});
