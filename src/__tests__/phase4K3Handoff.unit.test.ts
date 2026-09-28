/**
 * Phase 4 · K3 — a QR-handoff result that contradicts the ball-by-ball is refused
 * BEFORE anything is written (SC-433). resultCheck.unit.test.ts pins the decision;
 * this pins that uploadHandoff asks it first. Signature checking, scorer auth and
 * the completion itself are stubbed.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number | null } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert', 'filter', 'match', 'contains', 'overlaps', 'textSearch', 'returns', 'abortSignal', 'like', 'not', 'csv']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    const done = () => ({ data: null, error: null, ...mockNext(q) });
    chain.single = jest.fn(async () => { q.push('single'); return done(); });
    chain.maybeSingle = jest.fn(async () => { q.push('maybeSingle'); return done(); });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok(done())); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn((t: string) => start(`from:${t}`)), rpc: jest.fn((n: string, args?: unknown) => start(`rpc:${n}:${JSON.stringify(args ?? null)}`)) } };
});
const MATCH = '22222222-2222-4222-8222-222222222222';
jest.mock('../utils/qrHandoff', () => ({
  ...jest.requireActual('../utils/qrHandoff'),
  verifyHandoff: jest.fn(async () => ({ ok: true, payload: {
    v: 1, m: '22222222-2222-4222-8222-222222222222', d: 'dev', u: 'scorer', n: 'nonce-9', t: Date.now(),
    o: [{ k: '55555555-5555-4555-8555-555555555555', s: 1, t: 'result', r: { w: '33333333-3333-4333-8333-333333333333' } }],
  } })),
}));
jest.mock('../controllers/scoring.controller', () => ({
  authorizeScorer: jest.fn(async () => ({ ok: true, match: { id: 'm', status: 'live' } })),
  recordEventIdempotent: jest.fn(), recomputeSummary: jest.fn(async () => null), validateScoringEvent: jest.fn(async () => null), promoteToLive: jest.fn(),
}));
const mockComplete = jest.fn(async (_req: unknown, res: any) => res.json({ match: { id: 'm' } }));
jest.mock('../controllers/matches.controller', () => ({ completeMatch: (req: unknown, res: unknown) => mockComplete(req, res) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), isSportInactive: jest.fn(async () => false) }));
jest.mock('../utils/discrepancy', () => ({
  checkResultBeforeRecording: jest.fn(async () => ({ disagrees: true, recordedSide: 'A', derivedSide: 'B' })),
  checkAndRecordDiscrepancy: jest.fn(async () => ({ disagrees: true, recordedSide: 'A', derivedSide: 'B' })),
  recordUnsentPlayForFinalMatch: jest.fn(),
}));

// eslint-disable-next-line import/first
import { uploadHandoff } from '../controllers/qrHandoff.controller';

beforeEach(() => { mockLog = []; mockComplete.mockClear(); });

it('K3-59 (ffdb26e): a result contradicting the play is refused 409 RESULT_DISPUTED and the match is NOT completed', async () => {
  mockNext = (q) => (q[0] === 'from:matches' && q.some((c) => c.includes('winner_team_id')) ? { data: { status: 'live', winner_team_id: null } }
    : q[0] === 'from:matches' ? { data: { id: MATCH, status: 'live', sport_id: 's', voided_at: null } } : { data: null });
  const r: any = { statusCode: 200 };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await uploadHandoff({ userId: 'courier', params: { id: MATCH }, body: { envelope: {} }, headers: {} } as any, r);
  expect([r.statusCode, r.body.code]).toEqual([409, 'RESULT_DISPUTED']);
  expect(r.body.error).toMatch(/Nothing was recorded/);
  expect(mockComplete).not.toHaveBeenCalled();
});
