/**
 * N-R7-S165 (RW-G4-135, GiftPicker retry after a dropped reply): sendGift checked the balance before the
 * idempotent send_gift RPC, so a retry of a send that already went through (balance now below the cost)
 * was refused 400 Not enough coins instead of answering duplicate. A keyed send whose gift row exists now
 * goes on to the RPC (duplicate, no second charge).
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
let mockRpcCalls: Array<[string, any]> = [];
let mockRpc: (name: string, args: any) => { data?: unknown; error?: unknown } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'contains', 'filter']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  const rpc = (n: string, a: any) => {
    mockRpcCalls.push([n, a]);
    const out = { data: null, error: null, ...mockRpc(n, a) };
    const p: any = Promise.resolve(out);
    p.single = () => Promise.resolve(out);
    return p;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(rpc) } };
});
jest.mock('../utils/blocks', () => ({ isBlockedBetween: jest.fn(async () => false) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(async () => undefined), notifyUsers: jest.fn(async () => undefined), notifyUnlessBlocked: jest.fn(async () => undefined) }));
jest.mock('../controllers/badges.controller', () => ({ awardBadgesSafe: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { sendGift } from '../controllers/gifts.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const D = '22222222-2222-4222-8222-222222222222';
const KEY = '44444444-4444-4444-8444-444444444444';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn(), on: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (body: object) => { const r = res(); await sendGift({ userId: ME, params: {}, query: {}, body, headers: {} } as any, r); return r; };

// Gold Medal costs 12; the first send went through (22 → 10) but its reply was lost.
let priorRow: unknown = null;
beforeEach(() => {
  mockLog = []; mockRpcCalls = []; priorRow = null;
  mockNext = (q) => (q[0] === 'from:users' && q.some((c) => c.startsWith('single:'))
    ? { data: { coin_balance: 10, name: 'Dipak' } }
    : q[0] === 'from:users' ? { data: { id: D } }
    : q[0] === 'from:gift_transactions' ? { data: priorRow }
    : { data: null });
  mockRpc = (n) => (n === 'send_gift' ? { data: { status: 'duplicate', gift: { id: 'g1' }, new_balance: 10 } } : {});
});

test('N-R7-S165: the retry of a send that went through answers alreadySent, not Not enough coins', async () => {
  priorRow = { id: 'g1' };
  const r = await call({ receiverId: D, giftId: 'gold_medal', idempotency_key: KEY });
  expect(r.statusCode).toBe(200);
  expect(r.body).toMatchObject({ success: true, alreadySent: true, remainingBalance: 10 });
  expect(mockRpcCalls.find(([n]) => n === 'send_gift')![1].p_client_key).toBe(KEY);
});

test('N-R7-S165: a new key (nothing sent yet) with too few coins is still refused before the RPC', async () => {
  const r = await call({ receiverId: D, giftId: 'gold_medal', idempotency_key: KEY });
  expect(r.statusCode).toBe(400);
  expect(r.body).toMatchObject({ code: 'INSUFFICIENT_COINS', current: 10 });
  expect(mockRpcCalls).toHaveLength(0);
});

test('N-R7-S165: no key → refused as before, no gift lookup', async () => {
  const r = await call({ receiverId: D, giftId: 'gold_medal' });
  expect(r.statusCode).toBe(400);
  expect(mockLog.filter((q) => q[0] === 'from:gift_transactions')).toHaveLength(0);
});
