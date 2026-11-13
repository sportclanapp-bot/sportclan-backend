/**
 * N-R7-S155 / N-R7-S156 (Step 2 B14 SIDE-C6-1 / SIDE-C6-2).
 * S155: a hand-off result the completion refuses for an ordinary reason (no line-up) was answered
 * 409 RESULT_DISPUTED, so the hub counted it as "needs a decision". It is now passed on as the
 * refusal it is (its own status, message and code), so the hub says "not accepted" with the reason.
 * S156: a refused or disputed result still wrote the qr_handoffs ledger row, so the retry after the
 * cause was fixed was answered already_uploaded and the result was lost. No row is written then.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockPre: { disagrees: boolean; recordedSide?: string; derivedSide?: string } = { disagrees: false };
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number | null } = () => ({ data: null, error: null });
// Round 6: the hand-off now reads the scorer's account (suspended / deleted); here they are active.
const mockActiveSigner = (q: string[]) => (q[0] === 'from:users' && q.some((c) => c.includes('suspended_at, deleted_at')) ? { data: { suspended_at: null, deleted_at: null } } : {});
jest.mock('../utils/supabase', () => {
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert', 'filter', 'match', 'contains', 'overlaps', 'textSearch', 'returns', 'abortSignal', 'like', 'not', 'csv']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    const done = () => ({ data: null, error: null, ...mockNext(q), ...(mockActiveSigner(q).data && !mockNext(q).data ? mockActiveSigner(q) : {}) });
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
  checkResultBeforeRecording: jest.fn(async () => mockPre),
  checkAndRecordDiscrepancy: jest.fn(async () => ({ disagrees: false })),
  recordUnsentPlayForFinalMatch: jest.fn(),
}));

// eslint-disable-next-line import/first
import { uploadHandoff } from '../controllers/qrHandoff.controller';

const live = (q: Q) => (q[0] === 'from:matches' && q.some((c) => c.includes('winner_team_id')) ? { data: { status: 'scheduled', winner_team_id: null } }
  : q[0] === 'from:matches' ? { data: { id: MATCH, status: 'scheduled', sport_id: 's', voided_at: null } } : { data: null });
const run = async () => {
  const r: any = { statusCode: 200 };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await uploadHandoff({ userId: 'courier', params: { id: MATCH }, body: { envelope: {} }, headers: {} } as any, r);
  return r;
};
const ledgerWritten = () => mockLog.some((q) => q[0] === 'from:qr_handoffs' && q.some((c) => c.startsWith('insert:')));

beforeEach(() => { mockLog = []; mockComplete.mockClear(); mockNext = live; mockPre = { disagrees: false }; });

it('S155: a completion refused for an ordinary reason (no line-up) is passed on as that refusal, not RESULT_DISPUTED', async () => {
  mockComplete.mockImplementationOnce(async (_req: unknown, res: any) => res.status(400).json({ error: 'Ranked matches need at least one registered player on each side. Set the line-up first.' }));
  const r = await run();
  expect(mockComplete).toHaveBeenCalled();
  expect(r.statusCode).toBe(400);
  expect(r.body.code).not.toBe('RESULT_DISPUTED');
  expect(r.body.code).toBe('RESULT_REFUSED');
  expect(r.body.error).toMatch(/Set the line-up first/);
});

it('S155: a refusal that has its own code keeps it', async () => {
  mockComplete.mockImplementationOnce(async (_req: unknown, res: any) => res.status(400).json({ error: 'Nobody on one side has said they’re playing yet.', code: 'SIDE_NOT_CONFIRMED' }));
  const r = await run();
  expect([r.statusCode, r.body.code]).toEqual([400, 'SIDE_NOT_CONFIRMED']);
});

it('S156: a refused result writes no qr_handoffs row, so the retry applies it', async () => {
  mockComplete.mockImplementationOnce(async (_req: unknown, res: any) => res.status(400).json({ error: 'Ranked matches need at least one registered player on each side. Set the line-up first.' }));
  await run();
  expect(ledgerWritten()).toBe(false);
  mockLog = [];
  const again = await run();
  expect(again.statusCode).toBe(200);
  expect(again.body.status).toBe('uploaded');
  expect(again.body.result).toBe('recorded');
  expect(ledgerWritten()).toBe(true);
});

it('S156: a disputed result writes no qr_handoffs row either', async () => {
  mockPre = { disagrees: true, recordedSide: 'A', derivedSide: 'B' };
  const r = await run();
  expect([r.statusCode, r.body.code]).toEqual([409, 'RESULT_DISPUTED']);
  expect(ledgerWritten()).toBe(false);
});
