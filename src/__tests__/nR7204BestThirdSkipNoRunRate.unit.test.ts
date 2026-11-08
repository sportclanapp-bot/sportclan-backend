/**
 * N-R7-204 (Step 2 Batch 9, SPP1-CRM-161) · a carrom groups tournament with best thirds and no
 * tie-break order of its own: best_next.skipped read ['head_to_head', 'score_rate'] — net run
 * rate named as "left out: those players never met" in a sport that has none (and the app crashed
 * on the word). Only the rules left out because the teams never met are named.
 */
import { bestPlacedAcrossGroups, computeStats, type BestPlacedWhy } from '../utils/standings';

const m = (a: string, b: string, ga: number, gb: number) => ({ team_a_id: a, team_b_id: b, winner_team_id: ga > gb ? a : b, status: 'completed', score_summary: { A: { score: ga, sets: [ga ? 25 : 10] }, B: { score: gb, sets: [gb ? 25 : 10] } } });

test('the default order names only head-to-head as left out', () => {
  const ms = [m('a1', 'a3', 1, 0), m('b1', 'b3', 1, 0), m('c1', 'c3', 1, 0)];
  const stats = computeStats(['a1', 'a3', 'b1', 'b3', 'c1', 'c3'], ms as any);
  const why: BestPlacedWhy = {};
  bestPlacedAcrossGroups([['a1', 'a3'], ['b1', 'b3'], ['c1', 'c3']], 1, 2, stats, [], {}, why);
  expect(why.skipped).toEqual(['head_to_head']);
});
