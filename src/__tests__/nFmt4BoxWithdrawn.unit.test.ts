/**
 * N-FMT-4 (launch test plan, Round 3): in a box league, once a player withdrew, who moved up (and who
 * was crowned) was worked out as if the games against them never happened, while the Boxes tab still
 * counted them — the player shown on top wasn't the one who went up. The games count; the withdrawn
 * player just doesn't move up.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { boxTables } from '../controllers/tournaments.controller';

const res: Array<[string, string, string]> = [['S1', 'S2', 'S2'], ['S1', 'S3', 'S3'], ['S1', 'S4', 'S1'], ['S2', 'S3', 'S3'], ['S2', 'S4', 'S4'], ['S3', 'S4', 'S4']];
test('S3 withdraws after all six games: S4 is top of the box (as the Boxes tab), not S1', async () => {
  db = fakeDb({
    tournaments: [{ id: 'T', format: 'box', settings: { box: { round: 1 } }, tiebreaker_rules: [] }],
    tournament_entries: ['S1', 'S2', 'S3', 'S4'].map((t, i) => ({ tournament_id: 'T', team_id: t, group_label: '1', seed: i + 1, status: t === 'S3' ? 'withdrawn' : 'approved' })),
    matches: res.map(([a, b, w], k) => ({ id: `m${k}`, tournament_id: 'T', round: 1, group_label: '1', team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed', voided_at: null, score_summary: { team_a_score: w === a ? 2 : 0, team_b_score: w === b ? 2 : 0 } })),
  });
  const tables = await boxTables('T', { settings: { box: { round: 1 } }, tiebreaker_rules: [] });
  expect(tables).toEqual([['S4', 'S2', 'S1']]); // S3's games counted, S3 not in the order
});
