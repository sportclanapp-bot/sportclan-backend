/**
 * N-R7-338 (Step 2 B13, SIDE-C1b-1): a box (or group) whose rows are level on
 * every tie-break with nothing played read in team-id order (P06, P10, P08,
 * P07, P09 for seeds 6–10). The seed is now the last word before the team id;
 * a draw of lots still comes first.
 */
import { fakeDb } from './helpers/fakeSupabase';
import { rankTeamsDetailed } from '../utils/standings';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { boxTables } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { rankExtrasFor } from '../utils/rankExtras';

// team ids sort differently from the seeds (z… seed 1, a… seed 5)
const box = [['z6', 6], ['c10', 10], ['k8', 8], ['b7', 7], ['m9', 9]] as Array<[string, number]>;

test('level on everything, 0 played: seed order, not team id', () => {
  const seeds = new Map(box);
  const r = rankTeamsDetailed(box.map(([t]) => t), [], [], undefined, { seeds });
  expect(r.order).toEqual(['z6', 'b7', 'k8', 'm9', 'c10']);
  expect(r.level).toEqual([['z6', 'b7', 'k8', 'm9', 'c10']]); // still reported level
});

test('a draw of lots still beats the seed; unseeded go last, by team id', () => {
  const seeds = new Map<string, number>([['z6', 6], ['b7', 7]]);
  expect(rankTeamsDetailed(['z6', 'b7', 'y', 'a'], [], [], undefined, { seeds }).order).toEqual(['z6', 'b7', 'a', 'y']);
  expect(rankTeamsDetailed(['z6', 'b7'], [], [], undefined, { seeds, lots: ['b7', 'z6'] }).order).toEqual(['b7', 'z6']);
});

test('points still come first', () => {
  const seeds = new Map(box);
  const m = [{ id: 'm1', team_a_id: 'c10', team_b_id: 'z6', winner_team_id: 'c10', status: 'completed', score_summary: { team_a_score: 2, team_b_score: 0 } }];
  expect(rankTeamsDetailed(box.map(([t]) => t), m as never, [], undefined, { seeds }).order).toEqual(['c10', 'b7', 'k8', 'm9', 'z6']);
});

test('rankExtrasFor reads the seeds with the tournament id; boxTables lists the box in seed order', async () => {
  db = fakeDb({
    tournaments: [{ id: 'T', format: 'box', settings: { box: { round: 1 } }, tiebreaker_rules: [] }],
    tournament_entries: box.map(([t, s]) => ({ id: `e${t}`, tournament_id: 'T', team_id: t, group_label: '2', seed: s, status: 'approved' })),
    matches: [],
  });
  const ex = (await rankExtrasFor({ settings: {}, tiebreaker_rules: [] }, [], 'T'))('2');
  expect(ex.seeds?.get('c10')).toBe(10);
  expect((await rankExtrasFor({ settings: {}, tiebreaker_rules: [] }, []))('2').seeds).toBeUndefined();
  expect(await boxTables('T', { settings: { box: { round: 1 } }, tiebreaker_rules: [] })).toEqual([['z6', 'b7', 'k8', 'm9', 'c10']]);
});
