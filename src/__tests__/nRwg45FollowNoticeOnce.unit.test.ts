/**
 * N-RWG4-5 (launch test plan): unfollowing and following again sent a fresh
 * "New follower" notification every time (unfollow deletes the row, so the
 * re-follow guard never fired) — three rounds, three notifications. Now one a
 * day per follower, claimed the way the match reminders are.
 */
import { fakeDb } from './helpers/fakeSupabase';

const mockDb = { client: null as any };
jest.mock('../utils/supabase', () => ({ get supabase() { return mockDb.client; } }));
const mockNotify = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUsers: (...a: unknown[]) => mockNotify(...a) }));
jest.mock('../controllers/badges.controller', () => ({ awardBadgesSafe: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { followUser, unfollowUser } from '../controllers/users.controller';

const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
};
const claims = new Set<string>();
let db: ReturnType<typeof fakeDb>;
beforeEach(() => {
  mockNotify.mockClear();
  claims.clear();
  db = fakeDb({ users: [{ id: 'f', name: 'P3 FMT Player 07', deleted_at: null }, { id: 'g', name: 'G', deleted_at: null }], user_blocks: [], follow_relationships: [] });
  // notification_sends has UNIQUE(user_id, job_type, sent_on).
  mockDb.client = {
    from: (t: string) => (t === 'notification_sends'
      ? { insert: async (r: { user_id: string; job_type: string; sent_on: string }) => {
        const k = `${r.user_id}|${r.job_type}|${r.sent_on}`;
        if (claims.has(k)) return { error: { code: '23505', message: 'duplicate' } };
        claims.add(k); return { error: null };
      } }
      : db.client.from(t)),
  };
});
afterEach(() => jest.useRealTimers());
const settle = () => new Promise((r) => setImmediate(r));
const follow = async (by: string, who: string) => { const r = res(); await followUser({ userId: by, params: { id: who } } as any, r); await settle(); await settle(); return r; };
const unfollow = async (by: string, who: string) => { await unfollowUser({ userId: by, params: { id: who } } as any, res()); };

test('follow, unfollow, follow, unfollow, follow: one "New follower"', async () => {
  for (let i = 0; i < 3; i++) {
    expect((await follow('f', 'g')).body).toEqual({ success: true });
    if (i < 2) await unfollow('f', 'g');
  }
  expect(mockNotify).toHaveBeenCalledTimes(1);
  expect(mockNotify.mock.calls[0]![1]).toMatchObject({ type: 'follow', title: 'New follower', body: 'P3 FMT Player 07 started following you' });
  expect(db.t('follow_relationships')).toHaveLength(1); // the follow itself still works every time
});

test('a different follower is still told', async () => {
  await follow('f', 'g');
  await follow('g', 'f');
  expect(mockNotify).toHaveBeenCalledTimes(2);
});
