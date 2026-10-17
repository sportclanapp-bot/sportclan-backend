/**
 * Round 6 · E-001: two people who blocked EACH OTHER match two user_blocks rows. The block check
 * ended in .maybeSingle(), which PostgREST answers with an error and no data when two rows match —
 * so a mutual block read as "not blocked": the profile opened, follow and invites went through.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUnlessBlocked: jest.fn() }));
// eslint-disable-next-line import/first
import { isBlockedBetween } from '../utils/blocks';
// eslint-disable-next-line import/first
import { followUser, getUserById } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { createInvite } from '../controllers/invites.controller';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SPORT = '33333333-3333-4333-8333-333333333333';
const both = [{ id: 'b1' }, { id: 'b2' }]; // A blocked B, and B blocked A

/** PostgREST: maybeSingle() over more than one row is an error and no data (PGRST116). */
const many = (q: string[], rows: unknown[]) => {
  if (q.some((c) => c.startsWith('maybeSingle')) && !q.some((c) => c.startsWith('limit')) && rows.length > 1) {
    return { data: null, error: { code: 'PGRST116' } };
  }
  return { data: q.some((c) => c.startsWith('maybeSingle')) ? rows[0] ?? null : rows };
};
beforeEach(() => {
  mock.next = (q) => {
    if (q[0] === 'from:user_blocks') return many(q, both);
    if (q[0] === 'from:users') return { data: { id: B, name: 'B', deleted_at: null } };
    if (q[0] === 'from:sports') return { data: { id: SPORT, is_active: true } };
    return { data: [] };
  };
});

test('isBlockedBetween is true when both have blocked each other', async () => {
  expect(await isBlockedBetween(A, B)).toBe(true);
});
test('the profile stays hidden (404)', async () => {
  const r = res();
  await getUserById({ userId: A, params: { id: B } } as any, r);
  expect(r.statusCode).toBe(404);
});
test('follow is refused (403)', async () => {
  const r = res();
  await followUser({ userId: A, params: { id: B } } as any, r);
  expect(r.statusCode).toBe(403);
});
test('a play invite is refused (403)', async () => {
  const r = res();
  await createInvite({ userId: A, body: { receiver_id: B, sport_id: SPORT } } as any, r);
  expect(r.statusCode).toBe(403);
});
