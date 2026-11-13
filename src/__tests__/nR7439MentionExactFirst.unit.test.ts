/** N-R7-439 (SIDE-A12-1): typing a full handle listed longer look-alikes and never the person themselves. */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => new Set()) }));
// eslint-disable-next-line import/first
import { searchMentions } from '../controllers/community.controller';

const u = (n: string, name = `Player ${n}`) => ({ id: `id_${n}`, name, username: `p3b14_${n}`, profile_picture_url: null, discoverability: 'everyone', tag_privacy: 'everyone', deleted_at: null, is_test_seed: false });
const call = async (q: string) => {
  const r: any = { json: jest.fn((b: unknown) => { r.body = b; return r; }), status: jest.fn(() => r) };
  await searchMentions({ userId: 'me', query: { q } } as any, r);
  return r.body.candidates.map((c: any) => c.username) as string[];
};

describe('N-R7-439: the exact handle is listed first', () => {
  beforeEach(() => {
    const lookAlikes = Array.from({ length: 12 }, (_, i) => u(`u1${i}`));
    db = fakeDb({ users: [...lookAlikes, { ...u('x9', 'Zed'), username: 'zed_p3b14_u1' }, u('u1')] });
  });
  it('a full handle puts that person first', async () => {
    expect((await call('p3b14_u1'))[0]).toBe('p3b14_u1');
  });
  it('with or without the @, case ignored', async () => {
    expect((await call('@P3B14_U1'))[0]).toBe('p3b14_u1');
  });
  it('handles that start with the text come before ones that only contain it', async () => {
    db = fakeDb({ users: [{ ...u('x9', 'Zed'), username: 'zed_p3b14' }, u('u2')] });
    expect(await call('p3b14')).toEqual(['p3b14_u2', 'zed_p3b14']);
  });
});
