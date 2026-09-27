/**
 * Phase 3 · B03 (Community), 28 Sep 2026 — the backend fixes.
 *  F8  malformed input is a 400, not a 500 (ids, cursor, limit, since,
 *      non-string content, mentions, report reason);
 *  F9  an edit can't blank a post;
 *  F10 poll options can't be blank or repeated;
 *  F12 "publish now" restamps created_at so the post lands on top;
 *  F13 a scheduled post can't be liked, commented on or read by id by others;
 *  F18 a missing post's comments are a 404.
 * Supabase is a recording chain; each awaited query takes the next queued result.
 */
type Result = { data?: unknown; error?: unknown; count?: number | null };
let results: Result[] = [];
let queries: string[][] = [];
jest.mock('../utils/supabase', () => {
  const make = () => {
    const log: string[] = [];
    queries.push(log);
    const q: any = {};
    for (const m of ['select', 'insert', 'update', 'eq', 'neq', 'is', 'in', 'gt', 'gte', 'lt', 'order', 'range', 'or', 'not', 'limit']) {
      q[m] = jest.fn((...a: unknown[]) => { log.push(`${m}:${JSON.stringify(a)}`); return q; });
    }
    const next = () => results.shift() ?? { data: null, error: null, count: 0 };
    q.maybeSingle = jest.fn(async () => next());
    q.single = jest.fn(async () => next());
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(next()).then(ok, bad);
    return q;
  };
  return { supabase: { from: jest.fn(() => make()), rpc: jest.fn(() => make()) } };
});
jest.mock('../utils/blocks', () => ({
  blockedUserIds: jest.fn(async () => []),
  excludeIds: jest.fn((q: unknown) => q),
  isBlockedBetween: jest.fn(async () => false),
}));
jest.mock('../middleware/admin.middleware', () => ({ isAdminUser: jest.fn(async () => false) }));
jest.mock('../utils/testContent', () => ({
  hideTestFor: jest.fn(async () => false),
  excludeTest: jest.fn((q: unknown) => q),
  excludeTestEmbed: jest.fn((q: unknown) => q),
}));

// eslint-disable-next-line import/first
import {
  listPosts, getSportStoryCounts, createPost, updatePost, createComment, listComments, likePost, reportContent, parseFeedCursor,
} from '../controllers/community.controller';
// eslint-disable-next-line import/first
import { isEmbargoed } from '../utils/postVisibility';

const U = '11111111-1111-4111-8111-111111111111';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: 'me', params: { id: U }, query: {}, body: {}, ...req }, r); return r; };
const future = () => new Date(Date.now() + 2 * 86400000).toISOString();

beforeEach(() => { results = []; queries = []; });

describe('F8 · malformed input → 400', () => {
  test.each([
    [{ sport_id: 'abc' }], [{ city_id: 'abc' }], [{ author_id: 'abc' }], [{ user_id: 'abc' }],
    [{ cursor: 'garbage' }], [{ cursor: 'a|b' }], [{ cursor: `2026-09-28T00:00:00Z|${U}),id.gt.(x` }],
    [{ sport_id: [U, U] }],
  ])('GET /community/posts %j', async (query) => {
    const r = await call(listPosts, { query });
    expect(r.statusCode).toBe(400);
    expect(queries).toHaveLength(0); // refused before any query
  });
  test('a real cursor still parses; limit is clamped to 1..50', async () => {
    expect(parseFeedCursor(`2026-09-28T03:09:00.123Z|${U}`)).toEqual({ ts: '2026-09-28T03:09:00.123Z', id: U });
    expect(parseFeedCursor('2026-09-28T03:09:00+00:00')).toEqual({ ts: '2026-09-28T03:09:00+00:00', id: null });
    results = [{ data: [], error: null }];
    await call(listPosts, { query: { limit: '-5' } });
    expect(queries[0].join(' ')).toContain('limit:[1]');
  });
  test('sport-story-counts: since must be a date', async () => {
    expect((await call(getSportStoryCounts, { query: { since: 'garbage' } })).statusCode).toBe(400);
  });
  test.each([[123], [{ a: 1 }]])('POST a post with content %j', async (content) => {
    expect((await call(createPost, { body: { content } })).statusCode).toBe(400);
  });
  test('POST a post with mentions that aren\'t a list of ids', async () => {
    expect((await call(createPost, { body: { content: 'hi', mentions: 'notarray' } })).statusCode).toBe(400);
    expect((await call(createPost, { body: { content: 'hi', mentions: ['x'] } })).statusCode).toBe(400);
  });
  test('comment with non-string content', async () => {
    expect((await call(createComment, { body: { content: 123 } })).statusCode).toBe(400);
  });
  test('report reason must be short text', async () => {
    expect((await call(reportContent, { body: { target_type: 'post', target_id: U, reason: { a: 1 } } })).statusCode).toBe(400);
    expect((await call(reportContent, { body: { target_type: 'post', target_id: U, reason: 'x'.repeat(501) } })).statusCode).toBe(400);
  });
});

describe('F9 · an edit can\'t blank a post', () => {
  test.each([[''], ['   '], [123]])('PATCH content %j → 400, nothing written', async (content) => {
    const r = await call(updatePost, { body: { content } });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('Content is required');
    expect(queries).toHaveLength(0);
  });
});

describe('F10 · poll options', () => {
  test.each([[['', ' ']], [['A', 'a']], [['A', 5]]])('%j → 400', async (opts) => {
    const r = await call(createPost, { body: { content: 'Q?', type: 'poll', poll_options: opts } });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe("Poll options can't be blank or repeated.");
  });
  test('two good options go through to the insert', async () => {
    results = [{ data: { id: 'p1' }, error: null }];
    const r = await call(createPost, { body: { content: 'Q?', type: 'poll', poll_options: [' A ', 'B'] } });
    expect(r.statusCode).not.toBe(400);
  });
});

describe('F12 · publish now restamps created_at', () => {
  test('the update carries scheduled_at null and a fresh created_at', async () => {
    results = [
      { data: { author_id: 'me', deleted_at: null, scheduled_at: future() } }, // postForWrite
      { data: { scheduled_at: future() } }, // current row
      { data: { id: U }, error: null }, // update
    ];
    const before = Date.now();
    const r = await call(updatePost, { body: { scheduled_at: null } });
    expect(r.statusCode).toBe(200);
    const upd = queries.flat().find((l) => l.startsWith('update:'))!;
    const patch = JSON.parse(upd.slice('update:'.length))[0];
    expect(patch.scheduled_at).toBeNull();
    expect(Date.parse(patch.created_at)).toBeGreaterThanOrEqual(before);
  });
});

describe('F13 · a scheduled post is hidden from everyone but its author', () => {
  const embargoed = () => ({ data: { author_id: 'author', deleted_at: null, scheduled_at: future() } });
  test('isEmbargoed', () => {
    expect(isEmbargoed({ scheduled_at: future() })).toBe(true);
    expect(isEmbargoed({ scheduled_at: '2020-01-01T00:00:00Z' })).toBe(false);
    expect(isEmbargoed({ scheduled_at: null })).toBe(false);
  });
  test('like → 404', async () => {
    results = [embargoed()];
    expect((await call(likePost, {})).statusCode).toBe(404);
  });
  test('comment → 404', async () => {
    results = [embargoed()];
    expect((await call(createComment, { body: { content: 'hi' } })).statusCode).toBe(404);
  });
  test('comments list (signed out) → 404', async () => {
    results = [embargoed()];
    expect((await call(listComments, { userId: undefined })).statusCode).toBe(404);
  });
  test('the author still reads its thread', async () => {
    results = [embargoed(), { data: [], error: null, count: 0 }, { count: 0 }];
    expect((await call(listComments, { userId: 'author' })).statusCode).toBe(200);
  });
});

describe('F18 · a missing post\'s comments', () => {
  test('→ 404, not 200 []', async () => {
    results = [{ data: null }];
    const r = await call(listComments, {});
    expect(r.statusCode).toBe(404);
    expect(r.body).toEqual({ error: 'Post not found' });
  });
});
