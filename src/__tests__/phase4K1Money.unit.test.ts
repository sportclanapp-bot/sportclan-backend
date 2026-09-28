/**
 * Phase 4 · K1 — coins move atomically: a gift can't overdraw (A4-005) and an
 * award is an increment, not a read-modify-write (A4-006). Supabase and its
 * RPCs are mocked; each `from()` query resolves to `mockNext(q)`.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
const mockRpc = jest.fn(async (..._a: unknown[]): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null }));
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'range']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: (...a: unknown[]) => mockRpc(...a) } };
});
jest.mock('../utils/blocks', () => ({ isBlockedBetween: jest.fn(async () => false), blockedUserIds: jest.fn(async () => []), excludeIds: (q: unknown) => q }));
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(async () => undefined), notifyUser: jest.fn(async () => undefined) }));
jest.mock('../controllers/badges.controller', () => ({ awardBadgesSafe: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { sendGift } from '../controllers/gifts.controller';
// eslint-disable-next-line import/first
import { awardCoins } from '../utils/coins';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const res = () => {
  const r: any = { statusCode: 200, body: null, set: jest.fn(), setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, ...req }, r); return r; };
const rpcNames = () => mockRpc.mock.calls.map((c) => c[0]);
// The sender has enough by the fast-fail read; the receiver is a live account.
const people = (q: Q) => (q.some((c) => c.includes(`["id","${ME}"]`)) ? { data: { coin_balance: 100, name: 'Me' } } : { data: { id: OTHER } });

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockRpc.mockReset();
  mockRpc.mockImplementation(async () => ({ data: null, error: null }));
});

describe('K1-29a (1b1d38b, A4-005) · a gift is charged with a balance floor, atomically', () => {
  test('K1-29a (1b1d38b): send_gift reporting "insufficient" (a racing send got there first) → 400, no gift', async () => {
    mockNext = people;
    mockRpc.mockImplementation(async () => ({ data: { status: 'insufficient' }, error: null }));
    const r = await call(sendGift, { body: { receiverId: OTHER, giftId: 'flowers' } });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('Insufficient coins');
    expect(mockLog.some((q) => q[0] === 'from:gift_transactions')).toBe(false);
  });
  describe('the pre-052 fallback path (send_gift not deployed)', () => {
    const missing = { data: null, error: { code: 'PGRST202', message: 'no function' } };
    test('K1-29a (1b1d38b): the deduct is the conditional deduct_coins_if_sufficient, never an unconditional increment_coins(-cost)', async () => {
      mockNext = (q) => (q[0] === 'from:gift_transactions' ? { data: { id: 'g1' } } : people(q));
      mockRpc.mockImplementation(async (name: unknown) => (name === 'send_gift' ? missing : name === 'deduct_coins_if_sufficient' ? { data: 95, error: null } : { data: null, error: null }));
      const r = await call(sendGift, { body: { receiverId: OTHER, giftId: 'flowers' } });
      expect(r.statusCode).toBe(200);
      expect(r.body.remainingBalance).toBe(95);
      const deduct = mockRpc.mock.calls.find((c) => c[0] === 'deduct_coins_if_sufficient')!;
      expect(deduct[1]).toEqual({ target_user_id: ME, amount: 5 });
      expect(rpcNames()).not.toContain('increment_coins');
    });
    test('K1-29a (1b1d38b): the floor refuses (NULL balance) → 400 and no gift row', async () => {
      mockNext = people;
      mockRpc.mockImplementation(async (name: unknown) => (name === 'send_gift' ? missing : { data: null, error: null }));
      const r = await call(sendGift, { body: { receiverId: OTHER, giftId: 'flowers' } });
      expect(r.statusCode).toBe(400);
      expect(r.body.error).toBe('Insufficient coins');
      expect(mockLog.some((q) => q[0] === 'from:gift_transactions')).toBe(false);
    });
    test('K1-29a (1b1d38b): the gift insert fails after the charge → the coins are refunded', async () => {
      mockNext = (q) => (q[0] === 'from:gift_transactions' ? { data: null, error: { message: 'insert failed' } } : people(q));
      mockRpc.mockImplementation(async (name: unknown) => (name === 'send_gift' ? missing : name === 'deduct_coins_if_sufficient' ? { data: 95, error: null } : { data: null, error: null }));
      const r = await call(sendGift, { body: { receiverId: OTHER, giftId: 'flowers' } });
      expect(r.statusCode).toBe(500);
      expect(mockRpc.mock.calls.find((c) => c[0] === 'increment_coins')?.[1]).toEqual({ target_user_id: ME, amount: 5 });
    });
  });
});

describe('K1-30a (48f4849, A4-006) · awarding coins increments atomically', () => {
  test('K1-30a (48f4849): the pre-096 path credits via increment_coins and never writes users.coin_balance itself', async () => {
    mockRpc.mockImplementation(async (name: unknown) => (name === 'award_coin_event'
      ? { data: null, error: { code: 'PGRST202', message: 'missing' } }
      : { data: null, error: null }));
    mockNext = (q) => (q[0] === 'from:users' ? { data: { coin_balance: 40 } } : { data: null });
    const out = await awardCoins(ME, 'first_registration', 10, 'Signup bonus');
    expect(out).toEqual({ awarded: true, newBalance: 50 });
    expect(mockRpc.mock.calls.find((c) => c[0] === 'increment_coins')?.[1]).toEqual({ target_user_id: ME, amount: 10 });
    expect(mockLog.some((q) => q[0] === 'from:users' && q.some((c) => c.startsWith('update:')))).toBe(false);
  });
});
