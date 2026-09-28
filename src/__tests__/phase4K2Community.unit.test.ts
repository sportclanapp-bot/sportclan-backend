/**
 * Phase 4 · K2 — regression tests for backend community (feed / post) fixes
 * (see the app repo's phase4/K2.md). Supabase is mocked: `from()` queries
 * resolve via `mockNext(q)`, `rpc()` calls via `mockRpc`.
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
import { listPosts } from '../controllers/community.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const D = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const P2 = '55555555-5555-4555-8555-555555555555';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn(), on: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, ...req }, r); return r; };
const feedQ = () => mockLog.find((q) => q[0] === 'from:community_posts' && q.some((c) => c.startsWith('limit:')))!;

beforeEach(() => {
  mockLog = [];
  mockRpcCalls = [];
  mockNext = () => ({ data: null, error: null });
  mockRpc = () => ({ data: null, error: null });
  mockNotifyUsers.mockClear();
});

describe('K2-23 · the feed pages on (created_at, id) so equal timestamps are never skipped (SC-138)', () => {
  const TS = '2026-09-28T10:00:00.000Z';
  it('K2-23 (e1425d4): the feed is ordered created_at DESC then id DESC', async () => {
    await call(listPosts, {});
    const orders = feedQ().filter((c) => c.startsWith('order:'));
    expect(orders).toEqual(['order:["created_at",{"ascending":false}]', 'order:["id",{"ascending":false}]']);
  });
  it('K2-23 (e1425d4): a compound cursor filters on the tuple, not just created_at', async () => {
    await call(listPosts, { query: { cursor: `${TS}|${P2}` } });
    const q = feedQ();
    expect(q).toContain(`or:["created_at.lt.${TS},and(created_at.eq.${TS},id.lt.${P2})"]`);
    expect(q.some((c) => c.startsWith('lt:["created_at"'))).toBe(false);
  });
  it('K2-23 (e1425d4): a full page hands back a "created_at|id" nextCursor', async () => {
    mockNext = (q) => (q[0] === 'from:community_posts' && q.some((c) => c.startsWith('limit:'))
      ? { data: [{ id: POST, created_at: TS, author_id: D }, { id: P2, created_at: TS, author_id: D }] } : { data: [] });
    const r = await call(listPosts, { query: { limit: '2' } });
    expect(r.body.nextCursor).toBe(`${TS}|${P2}`);
  });
  it('K2-23 (e1425d4): a legacy ts-only cursor still works (created_at < ts)', async () => {
    await call(listPosts, { query: { cursor: TS } });
    expect(feedQ()).toContain(`lt:["created_at","${TS}"]`);
  });
});
