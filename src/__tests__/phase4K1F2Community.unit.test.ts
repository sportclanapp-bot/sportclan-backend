/**
 * Phase 4 · K1 · community + search read paths.
 *  K1-54 (eeace93) SC-68 — the profanity filter matches ambiguous words whole.
 *  K1-61 (11a9336) SC-81/82 — a viewer never sees posts, comments or people
 *        they have blocked, or who blocked them.
 * Supabase is mocked: every `from()` is its own query, resolved by mockNext(q);
 * user_blocks answers for real so the shared blockedUserIds() builds the set.
 */
import fs from 'fs';
import path from 'path';

type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'insert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/testContent', () => ({
  ...jest.requireActual('../utils/testContent'),
  hideTestFor: jest.fn(async () => false),
  testUserIdSet: jest.fn(async () => new Set()),
}));
jest.mock('../middleware/admin.middleware', () => ({ isAdminUser: jest.fn(async () => false) }));

// eslint-disable-next-line import/first
import { detectProfanity, listPosts, getPost, listComments } from '../controllers/community.controller';
// eslint-disable-next-line import/first
import { search } from '../controllers/search.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const B1 = '22222222-2222-4222-8222-222222222222'; // I blocked them
const B2 = '33333333-3333-4333-8333-333333333333'; // they blocked me
const POST = '44444444-4444-4444-8444-444444444444';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, ...req }, r); return r; };
const has = (q: Q, s: string) => q.some((c) => c.includes(s));
const EXCL = `not:["author_id","in","(${B1},${B2})"]`;
const EXCL_ID = `not:["id","in","(${B1},${B2})"]`;

beforeEach(() => {
  mockLog = [];
  mockNext = (q) => {
    if (q[0] === 'from:user_blocks') {
      if (has(q, 'select:["blocked_id"]')) return { data: [{ blocked_id: B1 }] };
      if (has(q, 'select:["blocker_id"]')) return { data: [{ blocker_id: B2 }] };
    }
    return { data: [] };
  };
});

describe('K1-54 (eeace93) SC-68 · profanity matched as whole words where the word hides inside others', () => {
  it.each(['association', 'class', 'pass the ball', 'grass court', 'assist', 'Emily Dickinson', 'scrap metal', 'fire retardant', 'grandiose', 'brandish'])(
    'K1-54 (eeace93): "%s" is clean',
    (t) => expect(detectProfanity(t)).toEqual([]),
  );
  it.each([['you ass', 'ass'], ['what a dumbass', 'dumbass'], ['asshole', 'asshole'], ['dickhead', 'dickhead'], ['this is crap', 'crap'], ['motherfucker', 'fuck'], ['bullshit', 'shit']])(
    'K1-54 (eeace93): "%s" is still caught (%s)',
    (t, w) => expect(detectProfanity(t)).toContain(w),
  );
});

describe('K1-61 (11a9336) SC-81/82 · blocked users (either direction) are hidden from the viewer', () => {
  it('K1-61 (11a9336): the feed excludes posts by both blocked users', async () => {
    await call(listPosts, {});
    const feed = mockLog.find((q) => q[0] === 'from:community_posts')!;
    expect(feed).toContain(EXCL);
  });
  it('K1-61 (11a9336): a blocked author\'s post read by id is filtered out', async () => {
    await call(getPost, { params: { id: POST } });
    expect(mockLog.filter((q) => q[0] === 'from:community_posts').some((q) => q.includes(EXCL))).toBe(true);
  });
  it('K1-61 (11a9336): comments by blocked users are excluded', async () => {
    mockNext = ((base) => (q: Q) => (q[0] === 'from:community_posts' ? { data: { id: POST, author_id: ME, scheduled_at: null } } : base(q)))(mockNext);
    await call(listComments, { params: { id: POST } });
    expect(mockLog.filter((q) => q[0] === 'from:post_comments').some((q) => q.includes(EXCL))).toBe(true);
  });
  it('K1-61 (11a9336): post search excludes blocked authors', async () => {
    await call(search, { query: { q: 'final', tab: 'posts' } });
    expect(mockLog.filter((q) => q[0] === 'from:community_posts').some((q) => q.includes(EXCL))).toBe(true);
  });
  it.each(['coaches', 'umpires', 'businesses', 'clubs'])('K1-61 (11a9336): people search tab %s excludes blocked users', async (tab) => {
    await call(search, { query: { q: 'an', tab } });
    expect(mockLog.filter((q) => q[0] === 'from:users').some((q) => q.includes(EXCL_ID))).toBe(true);
  });
  it('K1-61 (11a9336): a signed-out viewer blocks nothing (no user_blocks read)', async () => {
    await call(listPosts, { userId: undefined });
    expect(mockLog.some((q) => q[0] === 'from:user_blocks')).toBe(false);
  });
  it('K1-61 (11a9336): post and comment reads take the viewer when signed in (optionalAuth); rival skips blocked users', () => {
    const r = fs.readFileSync(path.join(__dirname, '..', 'routes', 'community.routes.ts'), 'utf8');
    expect(r).toContain("router.get('/posts/:id', optionalAuth, getPost);");
    expect(r).toContain("router.get('/posts/:id/comments', optionalAuth, listComments);");
    const u = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'users.controller.ts'), 'utf8');
    expect(u).toMatch(/const blockedRival = await blockedUserIds\(userId\);\s*const candidateIds = higher\.map\(\(h\) => h\.user_id\)\.filter\(\(uid\) => uid !== id && !blockedRival\.has\(uid\)\);/);
  });
});
