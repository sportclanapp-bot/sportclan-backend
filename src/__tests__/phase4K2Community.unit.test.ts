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
jest.mock('../utils/tagPrivacy', () => ({ taggableBy: jest.fn(async (_a: string, ids: string[]) => ids) }));

// eslint-disable-next-line import/first
import { listPosts, getPost, getSportStoryCounts, createPost } from '../controllers/community.controller';

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

describe('K2-36 · a not-yet-published scheduled post is embargoed on every read (SC-218)', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const post = (author: string) => (q: Q) => (q[0] === 'from:community_posts' ? { data: { id: POST, author_id: author, scheduled_at: future, deleted_at: null } } : { data: [] });
  it('K2-36a (65f062b): getPost of someone else’s future-scheduled post → 404', async () => {
    mockNext = post(D);
    const r = await call(getPost, { params: { id: POST } });
    expect([r.statusCode, r.body.error]).toEqual([404, 'Post not found']);
  });
  it('K2-36a (65f062b): its author can still open it', async () => {
    mockNext = post(ME);
    expect((await call(getPost, { params: { id: POST } })).statusCode).toBe(200);
  });
  it('K2-36c (65f062b): the story counts ignore scheduled posts', async () => {
    await call(getSportStoryCounts, {});
    expect(mockLog.find((q) => q[0] === 'from:community_posts')).toContain('is:["scheduled_at",null]');
  });
});

describe('K2-41 · post detail embeds the linked match (SC-229)', () => {
  it('K2-41 (70f9d28): getPost selects match:matches!match_id(… score_summary …) so the scorecard survives', async () => {
    mockNext = (q) => (q[0] === 'from:community_posts' ? { data: { id: POST, author_id: D, match: { id: 'm1', score_summary: { A: { runs: 120 } } } } } : { data: [] });
    const r = await call(getPost, { params: { id: POST } });
    const sel = mockLog.find((q) => q[0] === 'from:community_posts')!.find((c) => c.startsWith('select:'))!;
    expect(sel).toMatch(/match:matches!match_id\([^)]*score_summary/);
    expect(r.body.post.match.score_summary).toEqual({ A: { runs: 120 } });
  });
});

describe('K2-43 · poll my_vote on reads + post mentions notify (SC-234 / SC-235)', () => {
  const poll = { id: POST, author_id: D, poll_options: [{ option_id: 'o1', text: 'Yes', votes: 1 }] };
  const votes = (q: Q) => (q[0] === 'from:poll_votes' ? { data: [{ post_id: POST, option_id: 'o1' }] } : null);
  it('K2-43a (4900555): getPost carries my_vote_option_id for a poll I voted on', async () => {
    mockNext = (q) => votes(q) ?? (q[0] === 'from:community_posts' ? { data: { ...poll } } : { data: [] });
    const r = await call(getPost, { params: { id: POST } });
    expect(r.body.post.my_vote_option_id).toBe('o1');
  });
  it('K2-43a (4900555): the feed carries it too', async () => {
    mockNext = (q) => votes(q) ?? (q[0] === 'from:community_posts' && q.some((c) => c.startsWith('limit:')) ? { data: [{ ...poll }] } : { data: [] });
    const r = await call(listPosts, {});
    expect(r.body.posts[0].my_vote_option_id).toBe('o1');
  });
  it('K2-43b (4900555): mentioning someone in a post notifies them (type mention, actor = author)', async () => {
    mockRpc = (n) => (n === 'create_post_capped' ? { data: { id: POST } } : {});
    const r = await call(createPost, { body: { content: 'gg @dee', mentions: [D] } });
    await new Promise((x) => setTimeout(x, 0));
    expect(r.statusCode).toBe(201);
    const c = mockNotifyUsers.mock.calls.find((a) => (a[1] as any).type === 'mention')!;
    expect(c[0]).toEqual([D]);
    expect(c[2]).toEqual({ actorId: ME });
  });
});
