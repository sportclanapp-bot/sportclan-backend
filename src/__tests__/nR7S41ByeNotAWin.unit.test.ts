/**
 * N-R7-S41 (Step 2 Batch 13, FMT-TTN-DE-08 / FMT-TEN-DE-07) · a bye (a fixture with one side and no
 * opponent — a knockout or back-draw BYE) is not a match: 'Most wins' and every leaders board leave
 * it out, as team insights and match history do since F188/F189. Before: the side that went
 * through a BYE was given a win (P3 FMT Tennis DE 5: E 1W–2L, its only 'win' a bye).
 */
import { sportBoards } from '../utils/sportLeaders';

const m = (id: string, a: string | null, b: string | null, w: string | null, sets?: [number[], number[]]) => ({ id, team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed', result_type: null,
  score_summary: sets ? { A: { sets: sets[0] }, B: { sets: sets[1] } } : {} });
const M = [
  m('qf', 'D', 'E', 'D', [[6, 6], [2, 3]]),
  m('bye', null, 'E', 'E'), // Back draw round 1: BYE v E — E through without play
  m('b2', 'E', 'C', 'C', [[2, 3], [6, 6]]),
];
test.each(['tennis', 'tabletennis', 'chess', 'badminton'])('%s: E is 0W–2L, the bye adds nothing', (sport) => {
  const wins = sportBoards(sport, M as never, { C: 'C', D: 'D', E: 'E' }).find((b) => b.stat === 'wins')!;
  expect(wins.rows.find((r) => r.team_id === 'E')).toBeUndefined();
  expect(wins.rows.map((r) => `${r.name} ${r.detail}`)).toEqual(['C 1W–0L', 'D 1W–0L']);
});
