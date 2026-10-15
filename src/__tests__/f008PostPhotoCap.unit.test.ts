/**
 * F008 (launch test plan, Round 4) · a new post stored every media_urls entry, so a
 * client could save 6 photos on one post; the app and the edit path both stop at 4.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { createPost } from '../controllers/community.controller';

const IMG = (i: number) => `https://pub-test.r2.dev/post-media/p${i}.jpg`;
const call = async (media_urls: unknown) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await createPost({ userId: 'me', body: { content: 'hello', media_urls } } as any, r);
  return r;
};

beforeEach(() => {
  db = fakeDb();
  (db.client as any).rpc = jest.fn(() => ({ single: async () => ({ data: { id: 'p1' }, error: null }) }));
});

it('refuses a fifth photo before anything is saved', async () => {
  const r = await call([1, 2, 3, 4, 5, 6].map(IMG));
  expect(r.statusCode).toBe(400);
  expect(r.body).toEqual({ error: 'Maximum 4 images per post' });
  expect((db.client as any).rpc).not.toHaveBeenCalled();
});

it('four photos still post', async () => {
  const r = await call([1, 2, 3, 4].map(IMG));
  expect(r.body?.error).not.toBe('Maximum 4 images per post');
  expect((db.client as any).rpc).toHaveBeenCalled();
});
