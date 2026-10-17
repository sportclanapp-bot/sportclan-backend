/**
 * Round 6 · E-152: someone blocked with a wall's owner (either way) can't open or comment on their
 * wall post — but liking it by id went through.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
let blocked = false;
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  blockedUserIds: jest.fn(async () => new Set()),
  isBlockedBetween: jest.fn(async () => blocked),
}));
// eslint-disable-next-line import/first
import { likeProfilePost } from '../controllers/profilePosts.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const POST = '44444444-4444-4444-8444-444444444444';
const likes = () => mock.log.filter((q) => q[0] === 'from:profile_post_likes' && q.some((c) => c.startsWith('insert')));
beforeEach(() => {
  mock.log = [];
  mock.next = (q) => (q[0] === 'from:profile_posts' ? { data: { author_id: OWNER, deleted_at: null, likes_count: 1 } } : { data: null });
});
const like = async () => { const r = res(); await likeProfilePost({ userId: ME, params: { id: POST } } as any, r); return r; };

test('blocked either way: refused, no like stored', async () => {
  blocked = true;
  const r = await like();
  expect(r.statusCode).toBe(403);
  expect(likes()).toHaveLength(0);
});
test('not blocked: liked', async () => {
  blocked = false;
  const r = await like();
  expect(r.body.liked).toBe(true);
  expect(likes()).toHaveLength(1);
});
