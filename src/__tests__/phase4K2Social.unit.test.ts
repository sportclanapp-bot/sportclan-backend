/**
 * Phase 4 · K2 — regression tests for backend social / list fixes: follows,
 * blocks, kudos, comments, posts, availability, expenses (see the app repo's
 * phase4/K2.md). Supabase is mocked: every `from()` starts its own query,
 * resolved by `mockNext(q)`.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
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
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
let mockBlocked = new Set<string>();
let mockBlockedPair = false;
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  blockedUserIds: jest.fn(async () => mockBlocked),
  isBlockedBetween: jest.fn(async () => mockBlockedPair),
  targetUserHidden: jest.fn(async () => false),
}));
jest.mock('../utils/testContent', () => ({
  hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()),
}));
jest.mock('../middleware/admin.middleware', () => ({ isAdminUser: jest.fn(async () => false), requireAdmin: jest.fn() }));
const mockAwardCoins = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../utils/coins', () => ({ awardCoins: (...a: unknown[]) => mockAwardCoins(...a) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(async () => undefined), notifyUsers: jest.fn(async () => undefined), notifyUnlessBlocked: jest.fn(async () => undefined),
  sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
}));
jest.mock('../utils/teamAuth', () => ({ isTeamManager: jest.fn(async () => true), isTeamCaptain: jest.fn(async () => true), getTeamRole: jest.fn(async () => 'captain') }));
jest.mock('../utils/tagPrivacy', () => ({ taggableBy: jest.fn(async (_a: string, ids: string[]) => ids) }));

// eslint-disable-next-line import/first
import { followUser, blockUser, getFollowers, getFollowing, getMe } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { sendKudos } from '../controllers/kudos.controller';
// eslint-disable-next-line import/first
import { createPost, createComment, listComments } from '../controllers/community.controller';
// eslint-disable-next-line import/first
import { updateAvailability } from '../controllers/availability.controller';
// eslint-disable-next-line import/first
import { addExpense } from '../controllers/teamExpenses.controller';
// eslint-disable-next-line import/first
import giftsRouter from '../routes/gifts.routes';
// eslint-disable-next-line import/first
import { getReceivedGifts, getSentGifts } from '../controllers/gifts.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const D = '22222222-2222-4222-8222-222222222222';
const MATCH = '33333333-3333-4333-8333-333333333333';
const POST = '44444444-4444-4444-8444-444444444444';
const TEAM = '55555555-5555-4555-8555-555555555555';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn(), on: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, ...req }, r); return r; };
const uuids = (n: number) => Array.from({ length: n }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockBlocked = new Set();
  mockBlockedPair = false;
  mockAwardCoins.mockClear();
  jest.restoreAllMocks();
});

describe('K2-5c · the /users/me smart-notification job logs its failures (SC-112)', () => {
  it('K2-5c (e73f9e8): a throw inside runSmartNotifications → console.warn, /me still answers', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockNext = (q) => {
      if (q[0] === 'from:match_participants' && q.some((c) => c.includes('team_a_name, team_b_name, scheduled_at'))) throw new Error('db gone');
      if (q[0] === 'from:users') return { data: { id: ME, name: 'Dipak' } };
      return { data: [] };
    };
    await call(getMe, {});
    await flush();
    expect(warn).toHaveBeenCalledWith('[smart-notifications] failed:', 'db gone');
  });
});

describe('K2-6a · follower / following lists are paginated (SC-117)', () => {
  it.each([['followers', getFollowers], ['following', getFollowing]])('K2-6a (cdba317): %s read with .range() from ?limit/?offset', async (_n, fn) => {
    mockNext = (q) => (q[0] === 'from:users' ? { data: { id: D } } : { data: [] });
    await call(fn, { params: { id: D }, query: { limit: '5', offset: '10' } });
    const f = mockLog.find((q) => q[0] === 'from:follow_relationships')!;
    expect(f.find((c) => c.startsWith('range:'))).toBe('range:[10,14]');
  });
});

describe('K2-6f · comments are paginated (SC-117)', () => {
  it('K2-6f (cdba317): listComments reads post_comments with .range()', async () => {
    mockNext = (q) => (q[0] === 'from:community_posts' ? { data: { id: POST, author_id: D } } : { data: [], count: 0 });
    await call(listComments, { params: { id: POST }, query: { limit: '20', offset: '40' } });
    const c = mockLog.find((q) => q[0] === 'from:post_comments' && q.some((x) => x.startsWith('range:')));
    expect(c?.find((x) => x.startsWith('range:'))).toBe('range:[40,59]');
  });
});

describe('K2-7 · duplicate follow / block / kudos are idempotent by SQLSTATE (SC-116)', () => {
  const dupe = { code: '23505', message: 'violates unique constraint "uq_x"' }; // no word "duplicate"
  it('K2-7a (0782390): a re-follow losing the race (23505) is success, not 500', async () => {
    mockNext = (q) => (q[0] === 'from:follow_relationships' && q.some((c) => c.startsWith('insert:')) ? { error: dupe } : q[0] === 'from:users' ? { data: { id: D } } : { data: null });
    const r = await call(followUser, { params: { id: D } });
    expect([r.statusCode, r.body]).toEqual([200, { success: true }]);
  });
  it('K2-7a (0782390): a re-block losing the race (23505) is success, not 500', async () => {
    mockNext = (q) => (q[0] === 'from:user_blocks' && q.some((c) => c.startsWith('insert:')) ? { error: dupe } : { data: null });
    const r = await call(blockUser, { params: { id: D } });
    expect([r.statusCode, r.body]).toEqual([200, { success: true }]);
  });
  it('K2-7b (0782390): a concurrent double kudos (23505) → alreadySent, and NO second coin credit', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:match_participants') return { data: [{ user_id: ME }, { user_id: D }] };
      if (q[0] === 'from:kudos' && q.some((c) => c.startsWith('insert:'))) return { data: null, error: { code: '23505', message: 'dup' } };
      if (q[0] === 'from:kudos') return { data: mockLog.filter((x) => x[0] === 'from:kudos').length > 1 ? { id: 'k-winner' } : null };
      return { data: null };
    };
    const r = await call(sendKudos, { body: { toUserId: D, matchId: MATCH } });
    expect([r.statusCode, r.body]).toEqual([200, { kudos: { id: 'k-winner' }, alreadySent: true }]);
    expect(mockAwardCoins).not.toHaveBeenCalled();
  });
});

describe('K2-10a · user-supplied arrays are capped (AUDIT-5)', () => {
  it('K2-10a (d02809c): a post with 21 mentions → 400, nothing written', async () => {
    const r = await call(createPost, { body: { content: 'good game', mentions: uuids(21) } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'Too many mentions (max 20)']);
  });
  it('K2-10a (d02809c): a comment with 21 mentions → 400', async () => {
    const r = await call(createComment, { params: { id: POST }, body: { content: 'nice', mentions: uuids(21) } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'Too many mentions (max 20)']);
  });
  it('K2-10a (d02809c): availability with 31 sport_ids → 400', async () => {
    const r = await call(updateAvailability, { body: { sport_ids: uuids(31) } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'Too many sport_ids (max 30)']);
  });
  // Oct 2026 (Dipak): teams have no size cap, so neither does a split.
  it('K2-10a: an expense split among 51 is not refused for its number', async () => {
    mockNext = (q) => (q[0] === 'from:team_members' ? { data: { id: 'm', role: 'captain' } } : { data: null });
    const r = await call(addExpense, { params: { id: TEAM }, body: { title: 'Ground', amount: 100, split_among: uuids(51) } });
    expect(r.body?.error ?? '').not.toMatch(/Too many split_among/);
  });
});

describe('K2-8 · per-user gift routes are never shared-cacheable (SC-116)', () => {
  it.each([['get', '/received'], ['get', '/sent'], ['post', '/send']])('K2-8 (3944f57): %s %s sets Cache-Control private, no-store before anything else', (method, p) => {
    const layer = (giftsRouter as any).stack.find((l: any) => l.route?.path === p && l.route.methods[method]);
    const first = layer.route.stack[0].handle;
    const r: any = { set: jest.fn() };
    const next = jest.fn();
    first({}, r, next);
    expect(r.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(next).toHaveBeenCalled();
  });
  it('K2-8 (3944f57): the static catalogue keeps the mount’s public cache', () => {
    const layer = (giftsRouter as any).stack.find((l: any) => l.route?.path === '/catalogue');
    expect(layer.route.stack).toHaveLength(1);
  });
});

describe('K2-70 · gift history and follow lists page by offset (SC-306/307)', () => {
  it.each([['received', getReceivedGifts], ['sent', getSentGifts]])('K2-70a (7bfca78): %s gifts — .range(offset…), id tiebreaker, total/has_more', async (_n, fn) => {
    mockNext = (q) => (q[0] === 'from:gift_transactions' ? { data: [{ id: 'g1' }], count: 30 } : { data: [] });
    const r = await call(fn, { query: { limit: '10', offset: '10' } });
    const q = mockLog.find((x) => x[0] === 'from:gift_transactions')!;
    expect(q).toContain('range:[10,19]');
    expect(q).toContain('order:["id",{"ascending":false}]');
    expect(r.body).toMatchObject({ total: 30, has_more: true });
  });
  it('K2-70b (7bfca78): a full followers page says has_more', async () => {
    mockNext = (q) => (q[0] === 'from:users' ? { data: { id: D } } : q[0] === 'from:follow_relationships' ? { data: [{ users: { id: 'x' } }, { users: { id: 'y' } }] } : { data: [] });
    const r = await call(getFollowers, { params: { id: D }, query: { limit: '2' } });
    expect(r.body.has_more).toBe(true);
  });
});
