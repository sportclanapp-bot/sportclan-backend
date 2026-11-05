/**
 * N-R7-114 (Step 2, Batch 7, SP-PKB-C25 on emulator-5560): the Sport hub's Stats tab showed
 * 'YOUR PICKLEBALL RANK #22' above a ranking whose own row read 'Rank 15, tied, … you'. The
 * profile's rank counted players on the same rating as above you (a matches-played / id
 * tie-break) and counted test accounts the ranking hides; the ranking is a competition rank
 * (ties share a number, rated strictly higher + 1) without test accounts for a real viewer.
 * Both now use the ranking's rule.
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, '0')}`;
const ME = id(50); const PB = id(3); const VIEWER = id(60);
let db = fakeDb({});
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sportCache', () => ({ getSport: jest.fn(async () => ({ slug: 'pickleball' })) }));
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), targetUserHidden: jest.fn(async () => false) }), { virtual: true });

const prof = (n: number, rating: number, mp: number, test = false) => ({ user_id: id(n), sport_id: PB, rating, matches_played: mp, wins: mp, losses: 0, draws: 0, tu: { is_test_seed: test } });

test('the profile rank is the ranking rank: ties share it, hidden test accounts are not counted', async () => {
  db = fakeDb({
    users: [{ id: ME, name: 'Me', city_id: null, is_test_seed: false, deleted_at: null }, { id: VIEWER, name: 'Viewer', is_test_seed: false }],
    user_sport_profiles: [
      prof(50, 1216, 1),
      prof(10, 1216, 3), prof(11, 1216, 1), prof(12, 1216, 1), // same rating: tied with me, not above
      prof(20, 1300, 2), // a real player above
      prof(30, 1400, 5, true), // a test account: hidden from a real viewer's ranking
      prof(40, 1500, 0), // no rated match: not ranked
    ],
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getSportProfile } = require('../controllers/users.controller');
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await getSportProfile({ userId: VIEWER, params: { id: ME, sportId: PB }, query: {}, headers: {} } as any, r);
  expect(r.statusCode).toBe(200);
  expect(r.body.profile.globalRank).toBe(2);
});
