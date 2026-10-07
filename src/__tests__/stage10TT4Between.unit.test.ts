/**
 * Stage 10 · TT4 · tie-breaks counted only between the tied teams, then lots.
 * A table tennis group of four: A, B and C each beat one another once (and all
 * beat D). Overall game ratio says B, A, C; between the three it's A, B, C.
 */
import { rankTeams, rankTeamsDetailed } from '../utils/standings';
import { tiebreakPresetsFor, tiebreakLabel, tiebreakToken, tiebreaksFor } from '../utils/tournamentSettings';

/** games: each game's points ([11, 5] = A won 11-5). */
const tt = (id: string, a: string, b: string, games: Array<[number, number]>) => {
  const ga = games.filter(([x, y]) => x > y).length; const gb = games.length - ga;
  return { id, team_a_id: a, team_b_id: b, winner_team_id: ga > gb ? a : b, status: 'completed', score_summary: { A: { score: ga, sets: games.map((g) => g[0]) }, B: { score: gb, sets: games.map((g) => g[1]) } } } as any;
};
const W = (n: number): Array<[number, number]> => Array.from({ length: n }, () => [11, 5] as [number, number]);
const L = (n: number): Array<[number, number]> => Array.from({ length: n }, () => [5, 11] as [number, number]);
const ITTF_POINTS = { win: 2, draw: 1, loss: 1 } as never;

const m = [
  tt('1', 'A', 'B', W(3)), // A 3-0 B
  tt('2', 'B', 'C', W(3)), // B 3-0 C
  tt('3', 'C', 'A', [...W(3), ...L(2)]), // C 3-2 A
  tt('4', 'A', 'D', [...W(3), ...L(2)]), // A 3-2 D
  tt('5', 'B', 'D', W(3)), // B 3-0 D
  tt('6', 'C', 'D', W(3)), // C 3-0 D
];

test('ITTF: among the tied only — A (5:3), B (3:3), C (3:5)', () => {
  expect(rankTeams(['A', 'B', 'C', 'D'], m, ['head_to_head', 'h2h_score_ratio', 'h2h_points_ratio'], ITTF_POINTS)).toEqual(['A', 'B', 'C', 'D']);
});

test('the old overall game ratio gives another order — B, A, C', () => {
  expect(rankTeams(['A', 'B', 'C', 'D'], m, ['head_to_head', 'score_ratio'], ITTF_POINTS)).toEqual(['B', 'A', 'C', 'D']);
});

test('still level among themselves: a draw of lots, and the table says so', () => {
  const even = [tt('1', 'A', 'B', W(3)), tt('2', 'B', 'C', W(3)), tt('3', 'C', 'A', W(3))];
  const d = rankTeamsDetailed(['A', 'B', 'C'], even, ['head_to_head', 'h2h_score_ratio', 'h2h_points_ratio'], ITTF_POINTS);
  expect(d.level).toEqual([d.order]);
  expect(rankTeams(['A', 'B', 'C'], even, ['head_to_head', 'h2h_score_ratio'], ITTF_POINTS, { lots: ['C', 'A', 'B'] })).toEqual(['C', 'A', 'B']);
});

test('the presets and words per sport', () => {
  expect(tiebreakPresetsFor('table-tennis').find((p) => p.key === 'ittf')!.order).toEqual(['head_to_head', 'h2h_score_ratio', 'h2h_points_ratio']);
  expect(tiebreakPresetsFor('football').find((p) => p.key === 'uefa')!.order).toEqual(['head_to_head', 'h2h_score_diff', 'h2h_score_scored', 'score_diff', 'score_scored']);
  expect(tiebreakLabel('football', 'h2h_score_diff')).toBe('Goal difference between them');
  expect(tiebreakLabel('table-tennis', 'h2h_score_ratio')).toBe('Game ratio between them');
  expect(tiebreakLabel('tennis', 'h2h_points_ratio')).toBe('Game ratio between them');
  expect(tiebreakToken('h2h_goal_difference')).toBe('h2h_score_diff');
  expect(tiebreaksFor('chess')).not.toContain('h2h_score_diff');
  expect(tiebreaksFor('cricket')).not.toContain('h2h_points_ratio');
});
