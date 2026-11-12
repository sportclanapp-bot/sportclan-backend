/**
 * N-R7-348 (Step 2 B13, SIDE-C2b-1): two pickleball entries level on everything after
 * a 9–9 draw read P02 above P01 because nobody was seeded and the team id decided.
 * Unseeded entries are now placed in entry order (after any seeded ones), then team id.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { rankExtrasFor } from '../utils/rankExtras';
// eslint-disable-next-line import/first
import { rankTeamsDetailed } from '../utils/standings';

test('unseeded, level on everything: entry order (P01 before P02), not team id', async () => {
  db = fakeDb({
    tournaments: [{ id: 'T', format: 'round_robin', settings: {}, tiebreaker_rules: [] }],
    tournament_entries: [
      { id: 'e1', tournament_id: 'T', team_id: 'z-p01', seed: null, entered_at: '2026-11-12T07:49:27.588Z', status: 'approved' },
      { id: 'e2', tournament_id: 'T', team_id: 'a-p02', seed: null, entered_at: '2026-11-12T07:49:27.615Z', status: 'approved' },
      { id: 'e3', tournament_id: 'T', team_id: 'm-p03', seed: 1, entered_at: '2026-11-12T07:49:27.646Z', status: 'approved' },
    ],
    matches: [],
  });
  const ex = (await rankExtrasFor({ settings: {}, tiebreaker_rules: [] }, [], 'T'))(null as never);
  const draw = [{ id: 'm1', team_a_id: 'z-p01', team_b_id: 'a-p02', winner_team_id: null, status: 'completed', score_summary: { team_a_score: 9, team_b_score: 9 } }];
  // the two drawn entries (½ pt each) in the order they entered; m-p03 (0 pts) last
  expect(rankTeamsDetailed(['a-p02', 'z-p01', 'm-p03'], draw as never, [], undefined, ex).order).toEqual(['z-p01', 'a-p02', 'm-p03']);
  // nothing played: the seeded entry first, then the unseeded in entry order
  expect(rankTeamsDetailed(['a-p02', 'z-p01', 'm-p03'], [], [], undefined, ex).order).toEqual(['m-p03', 'z-p01', 'a-p02']);
});
