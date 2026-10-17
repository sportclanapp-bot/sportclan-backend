/**
 * Round 6 · E-153: the comments of a wall post ignored blocks. Someone blocked with the wall's
 * owner read the thread by id (the post itself is "not found" to them), and comments by people the
 * viewer had blocked were listed — community comments already leave them out.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
let blocked = new Set<string>();
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => blocked) }));
// eslint-disable-next-line import/first
import { listProfilePostComments } from '../controllers/profilePosts.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const PEST = '33333333-3333-4333-8333-333333333333';
const POST = '44444444-4444-4444-8444-444444444444';
const commentQueries = () => mock.log.filter((q) => q[0] === 'from:profile_post_comments');
beforeEach(() => {
  mock.log = [];
  mock.next = (q) => (q[0] === 'from:profile_posts' ? { data: { author_id: OWNER, deleted_at: null } } : { data: [], count: 0 });
});
const list = async () => { const r = res(); await listProfilePostComments({ userId: ME, params: { id: POST }, query: {} } as any, r); return r; };

test('blocked with the wall’s owner: 404 and the comments are not read', async () => {
  blocked = new Set([OWNER]);
  const r = await list();
  expect(r.statusCode).toBe(404);
  expect(commentQueries()).toHaveLength(0);
});
test('comments by someone I blocked are left out of the page and the count', async () => {
  blocked = new Set([PEST]);
  const r = await list();
  expect(r.statusCode).toBe(200);
  const qs = commentQueries();
  expect(qs).toHaveLength(2);
  for (const q of qs) expect(q).toContain(`not:${JSON.stringify(['author_id', 'in', `(${PEST})`])}`);
});
test('no blocks: listed as before', async () => {
  blocked = new Set();
  expect((await list()).statusCode).toBe(200);
});
