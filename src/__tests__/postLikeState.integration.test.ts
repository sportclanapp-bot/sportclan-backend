/**
 * SC-348 · like-state persistence + feed↔detail agreement — LIVE integration test.
 *
 * The bug: listPosts (feed) and getPost (detail) never attached the viewer's
 * is_liked, so after a like the FE reset the heart to empty on any refetch while the
 * (correct) likes_count stayed — the heart didn't persist and diverged from the count.
 *
 * Proves: after A likes a post, BOTH the feed read and the detail read report
 * is_liked=true for A (and likes_count agrees between the two views); after A unlikes,
 * both report is_liked=false. Also asserts comment_count agrees feed↔detail.
 *
 * Self-cleaning: unlikes in afterAll. Read-only otherwise (no content created).
 * Fixtures: z326agra.qa (viewer A) — likes then unlikes one existing feed post.
 */
import https from 'https';

const BASE = process.env.SC_BASE || 'https://sportclan-backend.onrender.com';

function call(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const u = new URL(BASE + path);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve({ status: res.statusCode || 0, data: JSON.parse(b || '{}') }); } catch { resolve({ status: res.statusCode || 0, data: {} }); } }); },
    );
    req.on('error', () => resolve({ status: 0, data: {} }));
    if (payload) req.write(payload);
    req.end();
  });
}
async function login(email: string, password: string): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const { status, data } = await call('POST', '/auth/login', undefined, { email, password });
    if (status === 200 && data.accessToken) return data.accessToken as string;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`login failed for ${email}`);
}
const fromFeed = (feed: any, id: string) => (feed.posts ?? feed.items ?? []).find((p: any) => p.id === id);

describe('SC-348 like-state persists + feed↔detail agree', () => {
  let aTok: string, postId: string;

  beforeAll(async () => {
    aTok = await login('z326agra.qa@sportclan.test', 'SportClanZ326pass');
    const feed = (await call('GET', '/community/posts?limit=1', aTok)).data;
    postId = (feed.posts ?? feed.items)[0].id;
    // Start from a known state: not liked.
    await call('DELETE', `/community/posts/${postId}/like`, aTok);
  });
  afterAll(async () => {
    await call('DELETE', `/community/posts/${postId}/like`, aTok);
  });

  it('after LIKE, both feed and detail report is_liked=true with matching counts', async () => {
    const detailBefore = (await call('GET', `/community/posts/${postId}`, aTok)).data.post;
    expect(detailBefore.is_liked).toBe(false); // fixed: field is now present

    await call('POST', `/community/posts/${postId}/like`, aTok);

    const feed = fromFeed((await call('GET', '/community/posts?limit=30', aTok)).data, postId);
    const detail = (await call('GET', `/community/posts/${postId}`, aTok)).data.post;

    expect(feed.is_liked).toBe(true);   // persists in the feed (was ABSENT → FE read false)
    expect(detail.is_liked).toBe(true); // and in detail — the two agree
    expect(feed.likes_count).toBe(detail.likes_count); // count consistent feed↔detail
    expect(detail.likes_count).toBe(detailBefore.likes_count + 1);
  });

  it('after UNLIKE, both feed and detail report is_liked=false', async () => {
    await call('DELETE', `/community/posts/${postId}/like`, aTok);
    const feed = fromFeed((await call('GET', '/community/posts?limit=30', aTok)).data, postId);
    const detail = (await call('GET', `/community/posts/${postId}`, aTok)).data.post;
    expect(feed.is_liked).toBe(false);
    expect(detail.is_liked).toBe(false);
    expect(feed.likes_count).toBe(detail.likes_count);
  });

  it('re-liking is idempotent — likes_count never double-counts one user', async () => {
    await call('POST', `/community/posts/${postId}/like`, aTok);
    const once = (await call('GET', `/community/posts/${postId}`, aTok)).data.post.likes_count;
    await call('POST', `/community/posts/${postId}/like`, aTok); // second like, same user
    const twice = (await call('GET', `/community/posts/${postId}`, aTok)).data.post.likes_count;
    expect(twice).toBe(once); // unchanged — one like per user
  });

  it('comment_count agrees between feed and detail', async () => {
    const feed = fromFeed((await call('GET', '/community/posts?limit=30', aTok)).data, postId);
    const detail = (await call('GET', `/community/posts/${postId}`, aTok)).data.post;
    expect(feed.comments_count).toBe(detail.comments_count);
  });
});
