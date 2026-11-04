/**
 * N-R7-107 (Step 2 B6, SPP1-TTN-091): an action sent later than it was tapped (the offline queue, a QR
 * hand-over) keeps the time the scorer's phone recorded it as payload.recorded_at — bounded: never after
 * now, never before the match was created — so the pad's warm-up / break timers don't count from the upload.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
// eslint-disable-next-line import/first
import { supabase } from '../utils/supabase';
// eslint-disable-next-line import/first
import { recordedAtOf, recordEventIdempotent } from '../controllers/scoring.controller';

const MATCH = '44444444-4444-4444-8444-444444444444'; const SCORER = '55555555-5555-4555-8555-555555555555';
const NOW = Date.parse('2026-11-04T10:00:00Z'); const MADE = '2026-11-04T09:00:00.000Z';

describe('recordedAtOf', () => {
  test('a sane time (ms or ISO) is kept', () => {
    expect(recordedAtOf(NOW - 120_000, MADE, NOW)).toBe('2026-11-04T09:58:00.000Z');
    expect(recordedAtOf('2026-11-04T09:58:00Z', MADE, NOW)).toBe('2026-11-04T09:58:00.000Z');
  });
  test('never in the future, never before the match was created', () => {
    expect(recordedAtOf(NOW + 3_600_000, MADE, NOW)).toBe(new Date(NOW).toISOString());
    expect(recordedAtOf('2020-01-01T00:00:00Z', MADE, NOW)).toBe(MADE);
  });
  test('missing or garbage → left out (an older app: the arrival time stands)', () => {
    for (const x of [undefined, null, '', 'soon', NaN, Infinity, {}]) expect(recordedAtOf(x, MADE, NOW)).toBeNull();
  });
});

describe('recordEventIdempotent keeps it in the payload', () => {
  const rpc = supabase.rpc as jest.Mock;
  beforeEach(() => { rpc.mockClear(); mock.next = () => ({ data: null }); });
  test('the phone’s recorded time travels as payload.recorded_at', async () => {
    const at = Date.now() - 58_000;
    await recordEventIdempotent({ matchId: MATCH, createdBy: SCORER, eventType: 'note', payload: { kind: 'warmup' }, clientKey: SCORER, recordedAt: at, matchCreatedAt: MADE });
    expect(rpc.mock.calls[0][1].p_payload).toEqual({ kind: 'warmup', recorded_at: new Date(at).toISOString() });
  });
  test('a client can’t smuggle its own payload.recorded_at; none sent → none kept', async () => {
    await recordEventIdempotent({ matchId: MATCH, createdBy: SCORER, eventType: 'note', payload: { kind: 'warmup', recorded_at: '2001-01-01T00:00:00Z' }, clientKey: SCORER });
    expect(rpc.mock.calls[0][1].p_payload).toEqual({ kind: 'warmup' });
  });
});

describe('a QR hand-over passes each op’s time on', () => {
  test('uploadHandoff hands op.a and the match’s created_at to the event writer', async () => {
    jest.resetModules();
    const at = Date.now() - 58_000;
    jest.doMock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
    jest.doMock('../utils/qrHandoff', () => ({ ...jest.requireActual('../utils/qrHandoff'), verifyHandoff: jest.fn(async () => ({ ok: true, payload: { v: 1, m: MATCH, u: SCORER, d: 'phone-1', n: 'nonce-1', t: Date.now(), o: [{ k: SCORER, s: 1, t: 'event', a: at, e: { event_type: 'note', payload: { kind: 'warmup' } } }] } })) }));
    const record = jest.fn(async () => ({ event: { id: 'e1' }, error: null, wasNew: true }));
    jest.doMock('../controllers/scoring.controller', () => ({ authorizeScorer: jest.fn(async () => ({ ok: true, match: { id: MATCH, status: 'scheduled', sport_id: 's', created_at: MADE } })), recordEventIdempotent: record, recomputeSummary: jest.fn(), validateScoringEvent: jest.fn(async () => null), promoteToLive: jest.fn(), startsPlayEvent: jest.fn(() => false) }));
    jest.doMock('../utils/sports', () => ({ isSportInactive: jest.fn(async () => false) }));
    const m = require('./r6Mock');
    m.mock.next = (q: string[]) => {
      if (q[0] === 'from:matches') return { data: { id: MATCH, status: 'scheduled', voided_at: null, sport_id: 's' } };
      if (q[0] === 'from:users') return { data: { suspended_at: null, deleted_at: null } };
      return { data: null };
    };
    const { uploadHandoff } = require('../controllers/qrHandoff.controller');
    const r = res();
    await uploadHandoff({ userId: SCORER, params: { id: MATCH }, body: { envelope: {} }, header: () => undefined } as any, r);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ clientKey: SCORER, recordedAt: at, matchCreatedAt: MADE }));
  });
});
