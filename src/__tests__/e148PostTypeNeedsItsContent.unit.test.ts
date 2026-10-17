/**
 * Round 6 · E-148: an edit could relabel any post as a match result (or a poll) — PATCH skipped the
 * SC-193 match check, and the Tournaments feed filter keys off the type. Creating had the same
 * hole: `post_type: 'match_result'` with no match, or `post_type: 'poll'` with no options.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(), notifyUser: jest.fn(), notifyUnlessBlocked: jest.fn() }));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q }));
// eslint-disable-next-line import/first
import { createPost, updatePost } from '../controllers/community.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const POST = '44444444-4444-4444-8444-444444444444';
let currentType = 'general';
const writes = () => mock.log.filter((q) => q[0] === 'from:community_posts' && q.some((c) => c.startsWith('update')));
beforeEach(() => {
  mock.log = [];
  mock.next = (q) => {
    if (q[0] === 'from:community_posts' && q.some((c) => c.startsWith('update'))) return { data: { id: POST, post_type: 'x' } };
    if (q[0] === 'from:community_posts') return { data: { author_id: ME, deleted_at: null, scheduled_at: null, post_type: currentType } };
    return { data: null };
  };
});
const edit = async (post_type: string) => { const r = res(); await updatePost({ userId: ME, params: { id: POST }, body: { content: 'We won', post_type } } as any, r); return r; };

test.each(['match_result', 'poll'])('an edit can’t turn a general post into %s', async (t) => {
  currentType = 'general';
  const r = await edit(t);
  expect(r.statusCode).toBe(400);
  expect(r.body.code).toBe('POST_TYPE_FIXED');
  expect(writes()).toHaveLength(0);
});
test('editing a match result keeps its type (the app sends it back)', async () => {
  currentType = 'match_result';
  const r = await edit('match_result');
  expect(r.statusCode).toBe(200);
  expect(writes()).toHaveLength(1);
});
test('an ordinary type change still works', async () => {
  currentType = 'general';
  expect((await edit('achievement')).statusCode).toBe(200);
});

const create = async (body: object) => { const r = res(); await createPost({ userId: ME, body: { content: 'We won', ...body }, header: () => undefined } as any, r); return r; };
const queries = () => mock.log.length; // refused before any read or write
test('creating a match result with no match is refused', async () => {
  const r = await create({ post_type: 'match_result' });
  expect(r.statusCode).toBe(400);
  expect(r.body.code).toBe('MATCH_REQUIRED');
  expect(queries()).toBe(0);
});
test('creating a poll by post_type with no options is refused', async () => {
  const r = await create({ post_type: 'poll' });
  expect(r.statusCode).toBe(400);
  expect(r.body.error).toBe('Polls need 2-5 options');
});
