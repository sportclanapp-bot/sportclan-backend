/**
 * N-R7-S10 (Step 2, Batch 5, SP-TEN-061): a player whose tennis matches were all casual (no
 * rated match, so no user_sport_profiles row) got the bare 1200 card back — the sets, games,
 * singles / doubles records and aces from those matches were never read. They are now; the
 * rating card stays the new-player one (1200, nothing played, no rank).
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, '0')}`;
const ME = id(1); const TN = id(3);
let db = fakeDb({});
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sportCache', () => ({ getSport: jest.fn(async () => ({ slug: 'tennis' })) }));
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), targetUserHidden: jest.fn(async () => false) }), { virtual: true });

test('casual tennis only (no profile row): the stats from the scores still come back', async () => {
  db = fakeDb({
    users: [{ id: ME, name: 'Ravi', deleted_at: null }],
    match_participants: [{ match_id: id(20), user_id: ME, team_side: 'A', match: { id: id(20), voided_at: null, sport_id: TN, status: 'completed' } }],
    matches: [{ id: id(20), team_a_id: 't1', team_b_id: 't2', winner_team_id: 't1', score_summary: { A: { sets: [6, 6] }, B: { sets: [4, 3] }, serve: { A: { aces: 2, double_faults: 1 }, B: { aces: 0, double_faults: 0 } } } }],
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getSportProfile } = require('../controllers/users.controller');
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await getSportProfile({ userId: ME, params: { id: ME, sportId: TN }, query: {}, headers: {} } as any, r);
  expect(r.body.profile).toMatchObject({ rating: 1200, matches_played: 0, wins: 0, losses: 0, cityRank: null, globalRank: null });
  expect(r.body.profile.sportStats).toMatchObject({ singles_won: 1, sets_won: 2, sets_lost: 0, tennis_games_won: 12, tennis_games_lost: 7, total_aces: 2, total_double_faults: 1 });
});

// Between typed names (the usual casual match: players picked, no saved teams) there are no team
// ids, so the winner is the stored winner side — the record counted nothing.
test('a casual win and a doubles loss between typed names count in the singles / doubles record', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { racketStats } = require('../utils/racketStats');
  const ms = [
    { id: 'm1', team_a_id: null, team_b_id: null, winner_team_id: null, score_summary: { A: { sets: [6, 6] }, B: { sets: [4, 3] }, winner_side: 'A' } },
    { id: 'm2', team_a_id: null, team_b_id: null, winner_team_id: null, score_summary: { A: { sets: [4, 6] }, B: { sets: [6, 7] }, winner_side: 'B' } },
  ];
  const out = racketStats(ms, new Map([['m1', 'A'], ['m2', 'A']]), new Map([['m1', 1], ['m2', 2]]));
  expect([out.singles_won, out.singles_lost, out.doubles_won, out.doubles_lost]).toEqual([1, 0, 0, 1]);
});
