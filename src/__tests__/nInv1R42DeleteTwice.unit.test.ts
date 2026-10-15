/**
 * N-INV1-R4-2 (launch test plan, Round 4) · deleting your post on one phone, then
 * again from an old feed on another, answered 404 'Post not found or not yours' —
 * and the app put the post back with 'Could not delete'. Deleting your own already-
 * deleted post is now a success; someone else's post or a missing one is still 404.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { deletePost } from '../controllers/community.controller';

const call = async (userId: string, id: string) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await deletePost({ userId, params: { id } } as any, r);
  return r;
};

beforeEach(() => {
  db = fakeDb({ community_posts: [{ id: 'p1', author_id: 'a', content: 'x', deleted_at: null }] });
});

it('the second delete of your own post succeeds (already deleted), and changes nothing', async () => {
  expect((await call('a', 'p1')).body).toEqual({ success: true });
  const when = db.tables.community_posts[0]!.deleted_at;
  expect(when).toBeTruthy();
  const again = await call('a', 'p1');
  expect(again.statusCode).toBe(200);
  expect(again.body).toEqual({ success: true, already_deleted: true });
  expect(db.tables.community_posts[0]!.deleted_at).toBe(when);
});

it('a post a moderator removed says so', async () => {
  Object.assign(db.tables.community_posts[0]!, { deleted_at: '2026-10-01T00:00:00Z', deleted_reason: 'moderator' });
  const r = await call('a', 'p1');
  expect(r.statusCode).toBe(410);
  expect(r.body.code).toBe('POST_REMOVED');
});

it('someone else\'s post, or a missing one, is still not found', async () => {
  expect((await call('b', 'p1')).statusCode).toBe(404);
  expect((await call('a', 'nope')).statusCode).toBe(404);
});
