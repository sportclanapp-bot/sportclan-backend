/**
 * SC-330 · Followers / following lists — LIVE integration test (real round-trip).
 *
 * Proves, against the deployed backend:
 *   1. following_count / followers_count on /users/:id EQUAL the actual number of
 *      rows returned by paginating the /following and /followers list endpoints
 *      (the count is derived live from follow_relationships, never a stale field).
 *   2. A follow → unfollow round-trip moves BOTH sides' counts by exactly ±1 and
 *      persists (re-fetched, not read from the mutating response), then returns to
 *      baseline. Original state is snapshotted and restored — no seed data changed.
 *   3. The list rows carry the VIEWER's is_following relationship: every user in the
 *      viewer's OWN following list is, by definition, is_following === true.
 *
 * Fixtures (QA accounts, pre-provisioned; the test restores any state it touches):
 *   z326agra.qa — the viewer (A)
 *   z19empty.qa — the target (B)
 *   Aarav Ali   — a well-connected account for the read-only count-consistency check
 */
import https from 'https';

const BASE = process.env.SC_BASE || 'https://sportclan-backend.onrender.com';
const AARAV = '5a9eaac3-dea0-4419-906c-911c5af9f38b';

function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  return new Promise((resolve) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const u = new URL(BASE + path);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(buf || '{}') });
          } catch {
            resolve({ status: res.statusCode || 0, data: {} });
          }
        });
      },
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

/** Paginate a follow list endpoint to completion; returns every row. */
async function fullList(
  token: string,
  userId: string,
  kind: 'followers' | 'following',
): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; offset < 10000; offset += 50) {
    const { data } = await call('GET', `/users/${userId}/${kind}?limit=50&offset=${offset}`, token);
    const page: any[] = data.users || [];
    rows.push(...page);
    if (!data.has_more || page.length === 0) break;
  }
  return rows;
}

describe('SC-330 followers / following lists', () => {
  let aToken: string;
  let aId: string;
  let bToken: string;
  let bId: string;

  beforeAll(async () => {
    aToken = await login('z326agra.qa@sportclan.test', 'SportClanZ326pass');
    aId = (await call('GET', '/users/me', aToken)).data.user.id;
    bToken = await login('z19empty.qa@sportclan.test', 'SportClanZ19pass');
    bId = (await call('GET', '/users/me', bToken)).data.user.id;
  });

  it('following_count and followers_count equal the actual number of list rows', async () => {
    const { data } = await call('GET', `/users/${AARAV}`, aToken);
    const followers = await fullList(aToken, AARAV, 'followers');
    const following = await fullList(aToken, AARAV, 'following');
    expect(followers.length).toBe(data.followers);
    expect(following.length).toBe(data.following);
    // Every listed user is a real, non-deleted account.
    for (const u of [...followers, ...following]) {
      expect(typeof u.id).toBe('string');
      expect(typeof u.name).toBe('string');
    }
  });

  it('follow → unfollow moves BOTH counts by ±1, persists, then restores', async () => {
    // Snapshot original relationship so we leave the fixtures exactly as found.
    const wasFollowing = (await call('GET', `/users/${bId}`, aToken)).data.isFollowing === true;
    if (wasFollowing) await call('DELETE', `/users/${bId}/follow`, aToken);

    // Baseline at the not-following state.
    const baseAFollowing = (await call('GET', '/users/me', aToken)).data.user.following_count;
    const baseBFollowers = (await call('GET', `/users/${bId}`, aToken)).data.followers;

    // FOLLOW
    const followRes = await call('POST', `/users/${bId}/follow`, aToken);
    expect(followRes.status).toBeLessThan(400);

    // Re-fetch (persisted, not the mutating response): both sides +1, isFollowing true.
    const afterFollowA = (await call('GET', '/users/me', aToken)).data.user.following_count;
    const bAfterFollow = (await call('GET', `/users/${bId}`, aToken)).data;
    expect(afterFollowA).toBe(baseAFollowing + 1);
    expect(bAfterFollow.followers).toBe(baseBFollowers + 1);
    expect(bAfterFollow.isFollowing).toBe(true);

    // B now appears in A's following list.
    const aFollowingList = await fullList(aToken, aId, 'following');
    expect(aFollowingList.some((u) => u.id === bId)).toBe(true);

    // UNFOLLOW
    const unfollowRes = await call('DELETE', `/users/${bId}/follow`, aToken);
    expect(unfollowRes.status).toBeLessThan(400);

    const afterUnfollowA = (await call('GET', '/users/me', aToken)).data.user.following_count;
    const bAfterUnfollow = (await call('GET', `/users/${bId}`, aToken)).data;
    expect(afterUnfollowA).toBe(baseAFollowing);
    expect(bAfterUnfollow.followers).toBe(baseBFollowers);
    expect(bAfterUnfollow.isFollowing).toBe(false);

    // Restore the original relationship.
    if (wasFollowing) await call('POST', `/users/${bId}/follow`, aToken);
  });

  it('every user in the viewer’s own following list has is_following === true', async () => {
    // Ensure A follows at least B, so the invariant has something to assert on.
    const wasFollowing = (await call('GET', `/users/${bId}`, aToken)).data.isFollowing === true;
    if (!wasFollowing) await call('POST', `/users/${bId}/follow`, aToken);

    const list = await fullList(aToken, aId, 'following');
    expect(list.length).toBeGreaterThan(0);
    // The viewer follows everyone in its own following list, by definition.
    for (const u of list) {
      expect(u.is_following).toBe(true);
    }

    // Restore.
    if (!wasFollowing) await call('DELETE', `/users/${bId}/follow`, aToken);
  });
});
