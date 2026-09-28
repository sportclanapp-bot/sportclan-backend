/**
 * Phase 4 · K3 — scoring input and QR handoff (SC-408/432, M6). Supabase is a
 * recording chain: every from()/rpc() starts its own query and resolves to
 * mockNext(q).
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
jest.mock('../utils/singles', () => ({ ...jest.requireActual('../utils/singles'), pendingRankedOpponent: jest.fn(async () => ({ pending: false })) }));

// eslint-disable-next-line import/first
import { generateKeyPairSync, sign as nodeSign } from 'crypto';
// eslint-disable-next-line import/first
import { createEvent, validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { verifyHandoff, canonicalBytes, type HandoffPayload } from '../utils/qrHandoff';

const ME = '11111111-1111-4111-8111-111111111111';
const MATCH = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';
const P2 = '44444444-4444-4444-8444-444444444444';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('SC-408 · an event type nobody reads is refused', () => {
  it('K3-50 (6d12d37): POST /scoring/:id/event with event_type "run" → 400 UNKNOWN_EVENT_TYPE, nothing read or written', async () => {
    const r = res();
    await createEvent({ userId: ME, params: { matchId: MATCH }, body: { event_type: 'run', payload: { runs: 4 } }, headers: {} } as any, r);
    expect([r.statusCode, r.body.code]).toEqual([400, 'UNKNOWN_EVENT_TYPE']);
    expect(mockLog).toHaveLength(0);
  });
  it('K3-50 (6d12d37): the shared validator (QR handoff path) refuses it too; a ball is fine', async () => {
    const m = { id: MATCH, status: 'live' };
    expect((await validateScoringEvent(MATCH, m, { event_type: 'run', payload: { runs: 4 } }))?.body.code).toBe('UNKNOWN_EVENT_TYPE');
    expect(await validateScoringEvent(MATCH, m, { event_type: 'ball', payload: { runs: 4 } })).toBeNull();
  });
});

describe('M6 · one player cannot bat and bowl the same ball', () => {
  it('K3-66 (3afede1): batsman_id (or legacy player_id) === bowler_id → 400 SAME_PLAYER_BOTH_ROLES; different or missing ids pass', async () => {
    const m = { id: MATCH, status: 'live' };
    const v = (payload: object) => validateScoringEvent(MATCH, m, { event_type: 'ball', payload: { runs: 1, ...payload } });
    expect((await v({ batsman_id: P1, bowler_id: P1 }))?.body.code).toBe('SAME_PLAYER_BOTH_ROLES');
    expect((await v({ player_id: P1, bowler_id: P1 }))?.body.code).toBe('SAME_PLAYER_BOTH_ROLES');
    expect(await v({ batsman_id: P1, bowler_id: P2 })).toBeNull();
    expect(await v({ bowler_id: P1 })).toBeNull();
  });
});

describe('SC-432 · a reinstalled phone is not a tamperer', () => {
  const keypair = () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return { pub: Buffer.from(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)).toString('base64url'), priv: privateKey };
  };
  const payload = (): HandoffPayload => ({
    v: 1, m: MATCH, d: 'device-abc', u: ME, n: 'nonce-1', t: Date.now(),
    o: [{ k: P1, s: 1, t: 'event', e: { event_type: 'ball', payload: { team_side: 'A', runs: 4 } } }],
  });
  const signed = (priv: ReturnType<typeof keypair>['priv']) => {
    const p = payload();
    return { p, sig: Buffer.from(nodeSign(null, canonicalBytes(p), priv)).toString('base64url') };
  };
  it('K3-56 (f249dba): a code signed by the key a reinstall rotated out → DEVICE_REVOKED "signed in again", not BAD_SIGNATURE', async () => {
    const oldK = keypair(); const newK = keypair();
    mockNext = (q) => (q[0] === 'from:device_signing_keys' ? { data: [
      { public_key: newK.pub, revoked_at: null, revoked_reason: null },
      { public_key: oldK.pub, revoked_at: '2026-09-21T00:00:00.000Z', revoked_reason: 'rotated' },
    ] } : { data: null });
    const r = await verifyHandoff(signed(oldK.priv));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('DEVICE_REVOKED');
    expect(r.detail).toMatch(/signed in again/);
  });
  it('K3-56 (f249dba): the live key still verifies; a key that is neither is still BAD_SIGNATURE', async () => {
    const oldK = keypair(); const newK = keypair(); const stranger = keypair();
    mockNext = (q) => (q[0] === 'from:device_signing_keys' ? { data: [
      { public_key: newK.pub, revoked_at: null },
      { public_key: oldK.pub, revoked_at: '2026-09-21T00:00:00.000Z', revoked_reason: 'rotated' },
    ] } : { data: null });
    expect((await verifyHandoff(signed(newK.priv))).ok).toBe(true);
    expect((await verifyHandoff(signed(stranger.priv))).reason).toBe('BAD_SIGNATURE');
  });
});
