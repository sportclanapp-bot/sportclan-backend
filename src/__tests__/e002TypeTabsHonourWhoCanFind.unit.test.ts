/**
 * Round 6 · E-002: "Who can find you" was honoured on the Players tab only. On Coaches, Umpires,
 * Businesses, Clubs, Associations, Leagues and Other a person set to "No one" (or "Followers") was
 * still found by name by anyone.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q }));
// eslint-disable-next-line import/first
import { search } from '../controllers/search.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const OPEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HIDDEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FOLLOWERS = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FOLLOWED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const people = [
  { id: OPEN, name: 'Coach Open', discoverability: 'everyone', acct: [{ account_type: 'coach' }] },
  { id: HIDDEN, name: 'Coach Hidden', discoverability: 'nobody', acct: [{ account_type: 'coach' }] },
  { id: FOLLOWERS, name: 'Coach Followers', discoverability: 'followers', acct: [{ account_type: 'coach' }] },
  { id: FOLLOWED, name: 'Coach Followed', discoverability: 'followers', acct: [{ account_type: 'coach' }] },
];
beforeEach(() => {
  mock.next = (q) => {
    if (q[0] === 'from:users') return { data: people };
    if (q[0] === 'from:follow_relationships') return { data: [{ following_id: FOLLOWED }] };
    return { data: [] };
  };
});
const find = async (tab: string) => {
  const r = res();
  await search({ userId: ME, query: { q: 'coach', tab } } as any, r);
  return (r.body.data as Array<{ id: string; discoverability?: string }>);
};

test.each(['coaches', 'umpires', 'businesses', 'clubs', 'associations', 'leagues', 'other'])(
  'the %s tab hides "No one" and followers-only people the caller does not follow',
  async (tab) => {
    const ids = (await find(tab)).map((u) => u.id);
    expect(ids).toEqual([OPEN, FOLLOWED]);
  },
);
test('the setting itself is not sent back', async () => {
  for (const u of await find('coaches')) expect(u).not.toHaveProperty('discoverability');
});
