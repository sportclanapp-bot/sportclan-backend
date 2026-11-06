/**
 * N-R7-S107 (Step 2, Batch 9, SP-CRM-197 / SP-CRM-C25 on local 4101): the all-time ranking
 * dropped a soft-deleted account AFTER the database had ranked and paged it, so the carrom
 * board's first page of 5 came back with 4 rows numbered 1, 2, 4, 5 (rank 3 a gap) and
 * "Show more" started at 6. The monthly ranking already leaves deleted accounts out before
 * numbering. Now the all-time ranking does too (in the query: page, total and every rank
 * agree), and the profile's rank (N-R7-114: the ranking's rule) does not count them above you.
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`;
const CR = id(900); const VIEWER = id(60);
let db = fakeDb({});
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sportCache', () => ({ getSport: jest.fn(async () => ({ slug: 'carrom' })) }));
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), targetUserHidden: jest.fn(async () => false) }), { virtual: true });

const prof = (n: number, rating: number, deleted = false) => ({ user_id: id(n), sport_id: CR, rating, matches_played: 3, wins: 2, losses: 1, draws: 0, gender_category: null, tu: { is_test_seed: false, deleted_at: deleted ? '2026-10-01T00:00:00Z' : null } });
const user = (n: number, deleted = false) => ({ id: id(n), name: `P${n}`, username: `p${n}`, city_id: null, is_test_seed: false, deleted_at: deleted ? '2026-10-01T00:00:00Z' : null });
const res = () => { const r: any = { statusCode: 200, body: null }; r.status = jest.fn((c: number) => { r.statusCode = c; return r; }); r.json = jest.fn((b: unknown) => { r.body = b; return r; }); r.set = jest.fn(() => r); r.setHeader = jest.fn(() => r); return r; };

beforeEach(() => {
  db = fakeDb({
    sports: [{ id: CR, slug: 'carrom', name: 'Carrom' }],
    users: [user(1), user(2), user(3, true), user(4), user(5), user(6), user(7), user(60)],
    user_sport_profiles: [prof(1, 1900), prof(2, 1800), prof(3, 1700, true), prof(4, 1600), prof(5, 1500), prof(6, 1400), prof(7, 1300)],
    user_blocks: [],
  });
});

test('the first page of 5 holds 5 live players ranked 1–5 (a deleted account leaves no gap)', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getLeaderboard } = require('../controllers/leaderboard.controller');
  const r = res();
  await getLeaderboard({ userId: VIEWER, query: { sport_id: CR, limit: '5', offset: '0' }, headers: {} } as never, r);
  expect(r.statusCode).toBe(200);
  expect(r.body.leaderboard.map((x: any) => `${x.rank}:${x.name}`)).toEqual(['1:P1', '2:P2', '3:P4', '4:P5', '5:P6']);
  expect(r.body.total).toBe(6);
  const r2 = res();
  await getLeaderboard({ userId: VIEWER, query: { sport_id: CR, limit: '5', offset: '5' }, headers: {} } as never, r2);
  expect(r2.body.leaderboard.map((x: any) => `${x.rank}:${x.name}`)).toEqual(['6:P7']);
});

test('the profile rank does not count a deleted account above you', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getSportProfile } = require('../controllers/users.controller');
  const r = res();
  await getSportProfile({ userId: VIEWER, params: { id: id(5), sportId: CR }, query: {}, headers: {} } as any, r);
  expect(r.statusCode).toBe(200);
  expect(r.body.profile.globalRank).toBe(4);
});
