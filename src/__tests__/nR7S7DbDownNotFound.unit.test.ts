/**
 * N-R7-S7 (Batch 17, X1-045 run, b17/P1/req.log 23:27): with the database
 * unreachable, GET /matches/:id and POST /scoring/:id/event answered 404
 * "Match not found" — the read's error was dropped — and the app's outbox took
 * the 4xx as a refusal and dropped the point. A failed read answers 503 (the
 * outbox retries a 5xx); a match that is really not there is still 404.
 */
let mockNext: () => { data?: unknown; error?: unknown } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = () => {
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'range', 'gt', 'gte', 'lt', 'upsert', 'insert']) {
      chain[m] = jest.fn(() => chain);
    }
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, error: null, ...mockNext() }));
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn(), matchAudienceIds: jest.fn(), matchFollowerIds: jest.fn() }));

// eslint-disable-next-line import/first
import { authorizeScorer } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { getMatch, claimScoringLease, takeOverScoringLease } from '../controllers/matches.controller';

const MID = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const DOWN = { data: null, error: { message: 'TypeError: fetch failed' } };
const res = () => {
  const r: any = { statusCode: 200, body: undefined };
  r.status = jest.fn((s: number) => { r.statusCode = s; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  r.set = jest.fn(() => r); r.setHeader = jest.fn(() => r);
  return r;
};
const req = (extra: Record<string, unknown> = {}) => ({
  userId: ME, params: { id: MID, matchId: MID }, body: { reason: 'scorer lost the phone' }, query: {},
  headers: { 'x-device-id': 'dev-1' }, header: (h: string) => (h.toLowerCase() === 'x-device-id' ? 'dev-1' : undefined),
  get: (h: string) => (h.toLowerCase() === 'x-device-id' ? 'dev-1' : undefined),
  ...extra,
}) as any;

beforeEach(() => { mockNext = () => ({ data: null, error: null }); });

describe('N-R7-S7 · database down is 503, not 404 Match not found', () => {
  test('authorizeScorer (POST /scoring/:id/event, undo, result): 503 when the read fails', async () => {
    mockNext = () => DOWN;
    const a = await authorizeScorer(MID, ME, 'dev-1');
    expect(a.ok).toBe(false);
    expect((a as { status: number }).status).toBe(503);
  });
  test('authorizeScorer: a match that is really not there is still 404', async () => {
    const a = await authorizeScorer(MID, ME, 'dev-1');
    expect((a as { status: number }).status).toBe(404);
  });
  test.each([
    ['GET /matches/:id', getMatch],
    ['POST /matches/:id/scoring-lease', claimScoringLease],
    ['POST /matches/:id/scoring-lease/takeover', takeOverScoringLease],
  ] as const)('%s: 503 when the read fails, 404 when the match is not there', async (_name, handler) => {
    mockNext = () => DOWN;
    const r1 = res();
    await handler(req(), r1);
    expect(r1.statusCode).toBe(503);
    expect(r1.body).toMatchObject({ code: 'DB_UNAVAILABLE' });
    mockNext = () => ({ data: null, error: null });
    const r2 = res();
    await handler(req(), r2);
    expect(r2.statusCode).toBe(404);
  });
});
