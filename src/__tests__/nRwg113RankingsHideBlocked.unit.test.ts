/**
 * N-RWG1-13 (launch test plan, Round 4) · someone you blocked (or who blocked you)
 * still showed in Rankings, and tapping their row opened 'This player doesn't exist'.
 * Their row is left out now (all-time and this month); everyone else keeps their
 * real rank.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), testUserIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => 's1') }));
jest.mock('../utils/sports', () => ({ isSportInactive: jest.fn(async () => false) }));
// eslint-disable-next-line import/first
import { getLeaderboard } from '../controllers/leaderboard.controller';

const call = async (query: Record<string, string> = {}) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await getLeaderboard({ userId: 'a', query: { sport_id: 's1', ...query } } as any, r);
  return r;
};

beforeEach(() => {
  db = fakeDb({
    users: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), username: id, deleted_at: null })),
    user_sport_profiles: [
      { user_id: 'b', sport_id: 's1', rating: 1500, matches_played: 5, wins: 4 },
      { user_id: 'c', sport_id: 's1', rating: 1400, matches_played: 5, wins: 3 },
      { user_id: 'a', sport_id: 's1', rating: 1300, matches_played: 5, wins: 2 },
      { user_id: 'd', sport_id: 's1', rating: 1200, matches_played: 5, wins: 1 },
    ],
    user_blocks: [{ blocker_id: 'a', blocked_id: 'b' }, { blocker_id: 'd', blocked_id: 'a' }],
  });
});

it('all-time: the players I blocked and who blocked me are not listed; the rest keep their rank', async () => {
  const r = await call();
  expect(r.statusCode).toBe(200);
  expect(r.body.leaderboard.map((e: any) => [e.user_id, e.rank])).toEqual([['c', 2], ['a', 3]]);
  expect(r.body.me.rank).toBe(3);
});

it('this month too', async () => {
  db.tables.rating_history = ['b', 'c', 'a', 'd'].map((u, i) => ({ id: `h${i}`, user_id: u, sport_id: 's1', new_rating: 1500 - i * 100, delta: 5, created_at: new Date().toISOString(), match: { id: 'm', voided_at: null } }));
  const r = await call({ period: 'monthly' });
  expect(r.body.leaderboard.map((e: any) => e.user_id)).toEqual(['c', 'a']);
});
