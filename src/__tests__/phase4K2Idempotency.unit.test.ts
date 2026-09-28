/**
 * Phase 4 · K2 — regression tests for the retry-idempotency fixes on the
 * content and money paths: send gift, create post, create comment, and the
 * malformed-key coercion (see the app repo's phase4/K2.md). Supabase is mocked:
 * `from()` queries resolve via `mockNext(q)`, `rpc()` calls via `mockRpc`.
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
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  blockedUserIds: jest.fn(async () => new Set()),
  isBlockedBetween: jest.fn(async () => false),
}));
jest.mock('../utils/testContent', () => ({
  hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()),
}));
jest.mock('../middleware/admin.middleware', () => ({ isAdminUser: jest.fn(async () => false), requireAdmin: jest.fn() }));
jest.mock('../utils/coins', () => ({ awardCoins: jest.fn(async () => undefined) }));
const mockNotifyUsers = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(async () => undefined), notifyUsers: (...a: unknown[]) => mockNotifyUsers(...a), notifyUnlessBlocked: jest.fn(async () => undefined),
  sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
}));
jest.mock('../controllers/badges.controller', () => ({ awardBadgesSafe: jest.fn(async () => undefined) }));
jest.mock('../utils/tagPrivacy', () => ({ taggableBy: jest.fn(async () => []) }));

// eslint-disable-next-line import/first
import { sendGift } from '../controllers/gifts.controller';
// eslint-disable-next-line import/first
import { createPost, createComment } from '../controllers/community.controller';
// eslint-disable-next-line import/first
import { normalizeClientKey } from '../utils/idempotency';

const ME = '11111111-1111-4111-8111-111111111111';
const D = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const KEY = '44444444-4444-4444-8444-444444444444';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn(), on: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, ...req }, r); return r; };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockLog = [];
  mockRpcCalls = [];
  mockNext = () => ({ data: null, error: null });
  mockRpc = () => ({ data: null, error: null });
  mockNotifyUsers.mockClear();
});

describe('K2-15 · send gift is retry-idempotent through the send_gift RPC (SC-114)', () => {
  const people = (q: Q) => (q[0] === 'from:users' && q.some((c) => c.startsWith('single:')) ? { data: { coin_balance: 500, name: 'Dipak' } } : q[0] === 'from:users' ? { data: { id: D } } : { data: null });
  const gift = { receiverId: D, giftId: 'gold_trophy', idempotency_key: KEY };
  it('K2-15 (3bcb64b): the tap’s idempotency_key reaches send_gift as p_client_key', async () => {
    mockNext = people;
    mockRpc = (n) => (n === 'send_gift' ? { data: { status: 'sent', gift: { id: 'g1' }, new_balance: 490 } } : {});
    const r = await call(sendGift, { body: gift });
    expect(r.statusCode).toBe(200);
    const [, args] = mockRpcCalls.find(([n]) => n === 'send_gift')!;
    expect(args.p_client_key).toBe(KEY);
  });
  it('K2-15 (3bcb64b): a retried tap (status duplicate) → alreadySent, no second notification', async () => {
    mockNext = people;
    mockRpc = (n) => (n === 'send_gift' ? { data: { status: 'duplicate', gift: { id: 'g1' }, new_balance: 490 } } : {});
    const r = await call(sendGift, { body: gift });
    await flush();
    expect(r.body).toMatchObject({ success: true, alreadySent: true, remainingBalance: 490 });
    expect(mockNotifyUsers).not.toHaveBeenCalled();
  });
  it('K2-15 (3bcb64b): an RPC failure is a 500 with NO sequential deduct/insert fallback', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockNext = people;
    mockRpc = (n) => (n === 'send_gift' ? { error: { code: '40P01', message: 'deadlock' } } : {});
    const r = await call(sendGift, { body: gift });
    expect(r.statusCode).toBe(500);
    expect(mockRpcCalls.map(([n]) => n)).toEqual(['send_gift']);
    expect(mockLog.filter((q) => q[0] === 'from:gift_transactions')).toHaveLength(0);
  });
});

describe('K2-16 · posts and comments carry the client key (SC-130)', () => {
  it('K2-16a (abe1ffc): createPost passes idempotency_key to create_post_capped as p_client_key', async () => {
    mockRpc = (n) => (n === 'create_post_capped' ? { data: { id: POST } } : {});
    await call(createPost, { body: { content: 'Great match today', idempotency_key: KEY } });
    const [, args] = mockRpcCalls.find(([n]) => n === 'create_post_capped')!;
    expect(args.p_client_key).toBe(KEY);
  });
  const post = (q: Q) => (q[0] === 'from:community_posts' ? { data: { id: POST, author_id: D, deleted_at: null, scheduled_at: null } } : null);
  it('K2-16b (abe1ffc): a keyed comment is inserted with client_key', async () => {
    mockNext = (q) => post(q) ?? (q[0] === 'from:post_comments' && q.some((c) => c.startsWith('insert:')) ? { data: { id: 'c1' } } : { data: null });
    const r = await call(createComment, { params: { id: POST }, body: { content: 'Well played', idempotency_key: KEY } });
    expect(r.statusCode).toBe(201);
    const ins = mockLog.find((q) => q[0] === 'from:post_comments' && q.some((c) => c.startsWith('insert:')))!;
    expect(ins.join()).toContain(`"client_key":"${KEY}"`);
  });
  it('K2-16c (abe1ffc): a no-key identical comment within 2s returns the first one (200 alreadyPosted), no insert', async () => {
    mockNext = (q) => post(q) ?? (q[0] === 'from:post_comments' && q.some((c) => c.startsWith('gt:["created_at"')) ? { data: { id: 'c0' } }
      : q[0] === 'from:post_comments' ? { data: { id: 'c0', content: 'Well played' } } : { data: null });
    const r = await call(createComment, { params: { id: POST }, body: { content: 'Well played' } });
    expect([r.statusCode, r.body.alreadyPosted]).toEqual([200, true]);
    expect(mockLog.filter((q) => q[0] === 'from:post_comments' && q.some((c) => c.startsWith('insert:')))).toHaveLength(0);
  });
});

describe('K2-17 · a same-key comment retry is deduped, not re-inserted keyless (SC-130)', () => {
  it('K2-17 (5ef5da2): 23505 on uq_post_comments_author_client_key → 200 alreadyPosted, exactly one insert attempt', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:community_posts') return { data: { id: POST, author_id: D, deleted_at: null, scheduled_at: null } };
      if (q[0] === 'from:post_comments' && q.some((c) => c.startsWith('insert:'))) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_post_comments_author_client_key"' } };
      }
      if (q[0] === 'from:post_comments') return { data: { id: 'c-original' } };
      return { data: null };
    };
    const r = await call(createComment, { params: { id: POST }, body: { content: 'Well played', idempotency_key: KEY } });
    expect([r.statusCode, r.body.alreadyPosted, r.body.comment]).toEqual([200, true, { id: 'c-original' }]);
    expect(mockLog.filter((q) => q[0] === 'from:post_comments' && q.some((c) => c.startsWith('insert:')))).toHaveLength(1);
  });
});

describe('K2-32 · a malformed idempotency_key is coerced to null, not a 500 (SC-179)', () => {
  it('K2-32 (ac200cd): normalizeClientKey passes a UUID through and nulls anything else', () => {
    expect(normalizeClientKey(KEY)).toBe(KEY);
    for (const bad of ['abc', 'not-a-uuid-at-all', 123, null, undefined, {}, `${KEY}x`]) expect(normalizeClientKey(bad)).toBeNull();
  });
  it('K2-32 (ac200cd): send gift / create post / comment forward null for a junk key', async () => {
    mockNext = (q) => (q[0] === 'from:users' && q.some((c) => c.startsWith('single:')) ? { data: { coin_balance: 500, name: 'D' } }
      : q[0] === 'from:users' ? { data: { id: D } }
        : q[0] === 'from:community_posts' ? { data: { id: POST, author_id: D, deleted_at: null, scheduled_at: null } }
          : q[0] === 'from:post_comments' && q.some((c) => c.startsWith('insert:')) ? { data: { id: 'c1' } } : { data: null });
    mockRpc = (n) => (n === 'send_gift' ? { data: { status: 'sent', gift: { id: 'g' }, new_balance: 1 } } : { data: { id: POST } });
    await call(sendGift, { body: { receiverId: D, giftId: 'gold_trophy', idempotency_key: 'retry-1' } });
    await call(createPost, { body: { content: 'Great match', idempotency_key: 'retry-1' } });
    const c = await call(createComment, { params: { id: POST }, body: { content: 'gg', idempotency_key: 'retry-1' } });
    expect(mockRpcCalls.find(([n]) => n === 'send_gift')![1].p_client_key).toBeNull();
    expect(mockRpcCalls.find(([n]) => n === 'create_post_capped')![1].p_client_key).toBeNull();
    expect(c.statusCode).toBe(201);
    expect(mockLog.find((q) => q[0] === 'from:post_comments' && q.some((x) => x.startsWith('insert:')))!.join()).not.toContain('retry-1');
  });
});
