/**
 * N-R7-S112 (SPP1-CHS-082) · best third places across chess groups: Buchholz,
 * Sonneborn-Berger and the direct encounter compare players who met, so they are
 * left out between groups and wins decide — the order was right, but no screen
 * said so. The standings carry `best_next`: what was left out and what decided
 * at the cut (the last player in, the first one out).
 */
import { bestPlacedAcrossGroups, computeStats, type BestPlacedWhy } from '../utils/standings';

const m = (a: string, b: string, ga: number, gb: number) => ({ team_a_id: a, team_b_id: b, winner_team_id: ga > gb ? a : gb > ga ? b : null, status: 'completed', score_summary: { A: { value: ga }, B: { value: gb } } });

test('thirds level on points: wins decide; BH, SB and the encounter are named as left out', () => {
  // 3/1/0: P07 (third in A) 1 win 2 losses = 3; P08 (third in B) 3 draws = 3 → level on points, P07 ahead on wins.
  const ms = [m('P07', 'a1', 1, 0), m('P07', 'a2', 0, 1), m('P07', 'a3', 0, 1), m('P08', 'b1', 0, 0), m('P08', 'b2', 0, 0), m('P08', 'b3', 0, 0)];
  const stats = computeStats(['P07', 'P08', 'a1', 'a2', 'a3', 'b1', 'b2', 'b3'], ms);
  const why: BestPlacedWhy = {};
  const got = bestPlacedAcrossGroups([['a2', 'a3', 'P07'], ['b1', 'b2', 'P08']], 2, 1, stats, ['buchholz', 'sonneborn_berger', 'head_to_head', 'wins', 'score_scored'], {}, why);
  expect(got).toEqual(['P07']);
  expect(why.skipped).toEqual(['buchholz', 'sonneborn_berger', 'head_to_head']);
  expect(why.cut).toEqual({ in: 'P07', out: 'P08', by: 'wins' });
});

test('everyone goes through (no cut) → cut null; no reason asked → same answer', () => {
  const ms = [m('X', 'p', 1, 0), m('Y', 'q', 0, 1)];
  const stats = computeStats(['X', 'Y', 'p', 'q'], ms);
  const why: BestPlacedWhy = {};
  expect(bestPlacedAcrossGroups([['p', 'X'], ['q', 'Y']], 1, 2, stats, ['wins'], {}, why)).toEqual(['X', 'Y']);
  expect(why.cut).toBeNull();
  expect(bestPlacedAcrossGroups([['p', 'X'], ['q', 'Y']], 1, 1, stats, ['wins'])).toEqual(['X']);
});
