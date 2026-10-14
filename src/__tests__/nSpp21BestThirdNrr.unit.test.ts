/**
 * N-SPP2-1 (launch test plan, Round 2): the best third-placed cricket teams from different groups
 * were compared without net run rate (left out as if it needed the teams to have met), so X (net
 * run rate −1.95, run difference −78) went through ahead of Y (−0.133, −79). It's each team's
 * own figure: it counts, by default and in every order that lists it.
 */
import { bestPlacedAcrossGroups } from '../utils/standings';

const base = { won: 1, drawn: 0, lost: 1, points: 2, played: 2, noResult: 0, rallyFor: 0, rallyAgainst: 0, rallyDiff: 0 };
const stats = new Map([
  ['X', { ...base, id: 'X', scored: 222, conceded: 300, diff: -78, nrr: -1.95 }],
  ['Y', { ...base, id: 'Y', scored: 221, conceded: 300, diff: -79, nrr: -0.133 }],
]) as never;
const groups = [['a1', 'a2', 'X'], ['b1', 'b2', 'Y']];
it.each([[undefined], [['nrr', 'wins']], [['head_to_head', 'nrr', 'score_diff', 'score_scored']], [['nrr', 'wins', 'head_to_head']]])('%j: Y, the better net run rate', (rules) => {
  expect(bestPlacedAcrossGroups(groups, 2, 1, stats, rules as never)[0]).toBe('Y');
});
it('a sport without a run rate still compares on the difference (football, default)', () => {
  const fb = new Map([['X', { ...base, id: 'X', scored: 5, conceded: 4, diff: 1, nrr: null }], ['Y', { ...base, id: 'Y', scored: 4, conceded: 4, diff: 0, nrr: null }]]) as never;
  expect(bestPlacedAcrossGroups(groups, 2, 1, fb, undefined)[0]).toBe('X');
});
