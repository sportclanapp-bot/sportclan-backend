/**
 * Phase 4 · K3 — community / profile post regressions (SC-354, SC-356, SC-357).
 * Supabase is a recording chain: every from()/rpc() starts its own query, and
 * each resolves to `mockNext(q)`, where `q` lists that query's builder calls.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number | null } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert']) {
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
  return { supabase: { from: jest.fn((t: string) => start(`from:${t}`)), rpc: jest.fn((n: string, args: unknown) => start(`rpc:${n}:${JSON.stringify(args)}`)) } };
});
jest.mock('../utils/blocks', () => ({
  blockedUserIds: jest.fn(async () => new Set()),
  excludeIds: jest.fn((q: unknown) => q),
  isBlockedBetween: jest.fn(async () => false),
}));
jest.mock('../middleware/admin.middleware', () => ({ isAdminUser: jest.fn(async () => false) }));
jest.mock('../utils/testContent', () => ({
  hideTestFor: jest.fn(async () => false),
  excludeTest: jest.fn((q: unknown) => q),
  excludeTestEmbed: jest.fn((q: unknown) => q),
}));
jest.mock('../utils/teamNames', () => ({ attachTeamNames: jest.fn(async () => undefined) }));
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn() }));
jest.mock('../utils/coins', () => ({ awardCoins: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { listPosts, createPost, getMyPostCount, unlikePost } from '../controllers/community.controller';
// eslint-disable-next-line import/first
import { updateProfilePost } from '../controllers/profilePosts.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, ...req }, r); return r; };
const isCount = (q: Q) => q.some((c) => c.startsWith('select:') && c.includes('"count":"exact"'));

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('SC-354 · author grid total + single-image media_urls', () => {
  it('K3-3 (f623282): an author-filtered list returns the real total, not the page length', async () => {
    mockNext = (q) => (q[0] === 'from:community_posts' && isCount(q) ? { count: 40 } : q[0] === 'from:community_posts' ? { data: [{ id: POST }] } : { data: [] });
    const r = await call(listPosts, { query: { author_id: OTHER } });
    expect(r.body.total).toBe(40);
    // someone else's grid: scheduled posts are not counted
    const cq = mockLog.find((q) => q[0] === 'from:community_posts' && isCount(q))!;
    expect(cq.join()).toContain(`eq:["author_id","${OTHER}"]`);
    expect(cq.join()).toContain('is:["scheduled_at",null]');
  });

  it('K3-3 (f623282): your own grid counts your scheduled posts; the main feed pays for no count', async () => {
    mockNext = (q) => (isCount(q) ? { count: 7 } : { data: [] });
    const own = await call(listPosts, { query: { author_id: ME } });
    expect(own.body.total).toBe(7);
    expect(mockLog.find(isCount)!.join()).not.toContain('scheduled_at');
    mockLog = [];
    const feed = await call(listPosts, { query: {} });
    expect(feed.body.total).toBeUndefined();
    expect(mockLog.some(isCount)).toBe(false);
  });

  it('K3-3 (f623282): a single-image post writes media_urls too', async () => {
    const img = 'https://pub-abc.r2.dev/p/1.jpg';
    mockNext = (q) => (q[0].startsWith('rpc:create_post_capped') ? { data: { id: POST } } : { data: null });
    const r = await call(createPost, { body: { content: 'one photo', media_urls: [img] } });
    expect(r.statusCode).toBeLessThan(300);
    const upd = mockLog.find((q) => q[0] === 'from:community_posts' && q.some((c) => c.startsWith('update:') && c.includes('media_urls')));
    expect(upd?.join()).toContain(`update:[{"media_urls":["${img}"]}]`);
  });
});

describe('SC-356 · update response carries is_liked', () => {
  it('K3-4 (75a616d): updateProfilePost attaches the viewer\'s is_liked', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:profile_post_likes') return { data: [{ post_id: POST }] };
      if (q[0] === 'from:profile_posts' && q.includes('maybeSingle')) return { data: { content: 'old', media_urls: null, link_url: null, deleted_at: null } };
      if (q[0] === 'from:profile_posts' && q.includes('single')) return { data: { id: POST, content: 'new' } };
      return { data: null };
    };
    const r = await call(updateProfilePost, { params: { id: POST }, body: { content: 'new' } });
    expect(r.statusCode).toBe(200);
    expect(r.body.post.is_liked).toBe(true);
  });
});

describe('SC-357 · the quota display counts both post types', () => {
  it('K3-5 (ef96ccd): my-count = community posts + profile posts this month', async () => {
    mockNext = (q) => (q[0] === 'from:community_posts' ? { count: 3 } : q[0] === 'from:profile_posts' ? { count: 2 } : {});
    const r = await call(getMyPostCount, {});
    expect(r.body.count).toBe(5);
  });
});

describe('B4 · the like that left', () => {
  it('K3-76 (ce8ac8d): unliking the last like deletes the "liked your post" notification', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:community_posts' && q.includes('maybeSingle')) return { data: { id: POST, author_id: OTHER, deleted_at: null, scheduled_at: null } };
      if (q[0] === 'from:post_likes' && q.some((c) => c.includes('"count":"exact"'))) return { count: 0 };
      if (q[0] === 'from:notifications' && q.some((c) => c.startsWith('select:'))) return { data: [{ id: 'n1', data: { post_id: POST }, read: true }] };
      return { data: null };
    };
    const r = await call(unlikePost, { params: { id: POST } });
    expect(r.body).toEqual({ liked: false });
    for (let i = 0; i < 20; i++) await new Promise((ok) => setImmediate(ok));
    const del = mockLog.find((q) => q[0] === 'from:notifications' && q.some((c) => c.startsWith('delete:')));
    expect(del?.join()).toContain('in:["id",["n1"]]');
  });
});
