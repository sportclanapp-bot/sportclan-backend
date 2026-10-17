/**
 * Round 6 · E-149: a scheduled post that isn't out yet is "not found" to everyone but its author
 * (open, like, comment — B03-F13). Reporting it by id was accepted, so a stranger could file a
 * report on it and learn it existed.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(), notifyUser: jest.fn(), notifyUnlessBlocked: jest.fn() }));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q }));
// eslint-disable-next-line import/first
import { reportContent } from '../controllers/community.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const AUTHOR = '22222222-2222-4222-8222-222222222222';
const POST = '44444444-4444-4444-8444-444444444444';
const COMMENT = '55555555-5555-4555-8555-555555555555';
let scheduledAt: string | null = null;
const reports = () => mock.log.filter((q) => q[0] === 'from:content_reports' && q.some((c) => c.startsWith('insert')));
beforeEach(() => {
  mock.log = [];
  mock.next = (q) => {
    if (q[0] === 'from:community_posts') return { data: { author_id: AUTHOR, deleted_at: null, scheduled_at: scheduledAt } };
    if (q[0] === 'from:post_comments') return { data: { author_id: AUTHOR, post_id: POST, deleted_at: null } };
    if (q[0] === 'from:content_reports' && q.some((c) => c.startsWith('insert'))) return { data: { id: 'r1' } };
    return { data: null };
  };
});
const report = async (target_type: string, target_id: string) => {
  const r = res();
  await reportContent({ userId: ME, body: { target_type, target_id, reason: 'spam' } } as any, r);
  return r;
};

test.each([['post', POST], ['comment', COMMENT]])('a %s on a scheduled post not yet out: 404, no report', async (type, id) => {
  scheduledAt = new Date(Date.now() + 86400000).toISOString();
  const r = await report(type, id);
  expect(r.statusCode).toBe(404);
  expect(reports()).toHaveLength(0);
});
test('once it is out, it can be reported', async () => {
  scheduledAt = new Date(Date.now() - 60000).toISOString();
  const r = await report('post', POST);
  expect(r.statusCode).toBe(201);
  expect(reports()).toHaveLength(1);
});
