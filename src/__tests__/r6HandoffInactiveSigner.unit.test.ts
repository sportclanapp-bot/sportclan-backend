/** Round 6 · N-R6-6: a QR code signed by a scorer who has since been suspended or deleted was still applied. */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
const MATCH = '44444444-4444-4444-8444-444444444444'; const SCORER = '55555555-5555-4555-8555-555555555555'; const COURIER = '66666666-6666-4666-8666-666666666666';
jest.mock('../utils/qrHandoff', () => ({ ...jest.requireActual('../utils/qrHandoff'), verifyHandoff: jest.fn(async () => ({ ok: true, payload: { m: '44444444-4444-4444-8444-444444444444', u: '55555555-5555-4555-8555-555555555555', d: 'phone-1', t: Date.now(), o: [] } })) }));
jest.mock('./../controllers/scoring.controller', () => ({ authorizeScorer: jest.fn(async () => ({ ok: true })), recordEventIdempotent: jest.fn(), recomputeSummary: jest.fn(), validateScoringEvent: jest.fn(), promoteToLive: jest.fn() }));
jest.mock('../utils/sports', () => ({ isSportInactive: jest.fn(async () => false) }));
// eslint-disable-next-line import/first
import { uploadHandoff } from '../controllers/qrHandoff.controller';
let signer: Record<string, unknown> | null = null;
beforeEach(() => {
  mock.next = (q) => {
    if (q[0] === 'from:matches') return { data: { id: MATCH, status: 'live', voided_at: null, sport_id: 's' } };
    if (q[0] === 'from:users') return { data: signer };
    return { data: [] };
  };
});
const call = async () => { const r = res(); await uploadHandoff({ userId: COURIER, params: { id: MATCH }, body: { envelope: {} }, header: () => undefined } as any, r); return r; };

test.each([
  ['suspended', { suspended_at: '2026-10-17T10:00:00Z', deleted_at: null }],
  ['deleted', { suspended_at: null, deleted_at: '2026-10-17T10:00:00Z' }],
])('a %s scorer’s code is refused (403 SCORER_INACTIVE) and nothing is applied', async (_w, row) => {
  signer = row;
  const r = await call();
  expect(r.statusCode).toBe(403);
  expect(r.body.code).toBe('SCORER_INACTIVE');
});
test('an active scorer’s code is not refused for that reason', async () => {
  signer = { suspended_at: null, deleted_at: null };
  const r = await call();
  expect(r.body?.code).not.toBe('SCORER_INACTIVE');
});
