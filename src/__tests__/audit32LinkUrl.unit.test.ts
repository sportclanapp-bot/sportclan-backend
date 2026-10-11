/** Audit #32 (11 Oct 2026): a post's link_url was stored without any check (javascript:, data: …). */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { createPost } from '../controllers/community.controller';

const call = async (link_url: unknown) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await createPost({ userId: 'me', body: { content: 'hello', link_url } } as any, r);
  return r;
};
describe('audit #32: post links are web addresses', () => {
  it.each(['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.y', 'not a url', 42])('refuses %p', async (v) => {
    expect((await call(v)).body?.code).toBe('BAD_LINK');
  });
  it('accepts https (it gets past the link check to the save)', async () => {
    const client: any = db.client;
    client.rpc = jest.fn(() => ({ single: async () => ({ data: { id: 'p1' }, error: null }) }));
    expect((await call('https://sportclan.app/x')).body?.code).not.toBe('BAD_LINK');
    expect(client.rpc).toHaveBeenCalled();
  });
});
