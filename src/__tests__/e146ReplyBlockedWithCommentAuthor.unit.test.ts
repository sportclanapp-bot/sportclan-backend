/**
 * Round 6 · E-146: replying to a comment checked a block with the POST's author only. Someone the
 * COMMENT's author had blocked (or who had blocked them) could still reply to them — the reply is
 * addressed to that author and tells them. Reacting to their comment already checked this.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(), notifyUser: jest.fn(), notifyUnlessBlocked: jest.fn() }));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q }));
const POST = '44444444-4444-4444-8444-444444444444';
const PARENT = '55555555-5555-4555-8555-555555555555';
const ME = '11111111-1111-4111-8111-111111111111';
const POST_AUTHOR = '22222222-2222-4222-8222-222222222222';
const COMMENTER = '33333333-3333-4333-8333-333333333333';
let blockedPair: [string, string] | null = null;
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  blockedUserIds: jest.fn(async () => new Set()),
  isBlockedBetween: jest.fn(async (a: string, b: string) => !!blockedPair && blockedPair.includes(a) && blockedPair.includes(b)),
}));
// eslint-disable-next-line import/first
import { createComment } from '../controllers/community.controller';

const inserts = () => mock.log.filter((q) => q[0] === 'from:post_comments' && q.some((c) => c.startsWith('insert')));
beforeEach(() => {
  mock.log = [];
  mock.next = (q) => {
    if (q[0] === 'from:community_posts') return { data: { author_id: POST_AUTHOR, deleted_at: null, scheduled_at: null } };
    if (q[0] === 'from:post_comments' && q.some((c) => c.startsWith('insert'))) return { data: { id: 'new' } };
    if (q[0] === 'from:post_comments') return { data: { author_id: COMMENTER, post_id: POST, deleted_at: null } };
    return { data: null };
  };
});
const reply = async () => {
  const r = res();
  await createComment({ userId: ME, params: { id: POST }, body: { content: 'nice', parent_id: PARENT, idempotency_key: '66666666-6666-4666-8666-666666666666' } } as any, r);
  return r;
};

test('a reply to a comment whose author is blocked with me is refused, nothing posted', async () => {
  blockedPair = [ME, COMMENTER];
  const r = await reply();
  expect(r.statusCode).toBe(403);
  expect(r.body).toEqual({ error: 'You can’t reply to this comment.', code: 'BLOCKED' });
  expect(inserts()).toHaveLength(0);
});
test('with no block, the reply is posted', async () => {
  blockedPair = null;
  const r = await reply();
  expect(r.statusCode).toBe(201);
  expect(inserts()).toHaveLength(1);
});
