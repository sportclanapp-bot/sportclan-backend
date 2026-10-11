/** Audit #29 (11 Oct 2026): the @mention picker ignored "who can find you" / "who can tag you". */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => new Set()) }));
// eslint-disable-next-line import/first
import { searchMentions } from '../controllers/community.controller';

const u = (id: string, discoverability: string, tag_privacy: string) => ({ id, name: `Ravi ${id}`, username: `ravi_${id}`, profile_picture_url: null, discoverability, tag_privacy, deleted_at: null, is_test_seed: false });
describe('audit #29: mention search honours privacy', () => {
  it('nobody / followers-only people show only to those allowed', async () => {
    db = fakeDb({
      users: [u('open', 'everyone', 'everyone'), u('hidden', 'nobody', 'everyone'), u('notag', 'everyone', 'nobody'), u('fans', 'everyone', 'followers'), u('fans2', 'followers', 'everyone')],
      follow_relationships: [{ follower_id: 'me', following_id: 'fans2' }],
    });
    const r: any = { json: jest.fn((b: unknown) => { r.body = b; return r; }), status: jest.fn(() => r) };
    await searchMentions({ userId: 'me', query: { q: 'ravi' } } as any, r);
    expect(r.body.data.map((x: any) => x.id).sort()).toEqual(['fans2', 'open']);
    expect(r.body.data[0]).not.toHaveProperty('tag_privacy');
  });
});
