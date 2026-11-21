/**
 * Q52 + Q65 (Dipak, 21 Nov 2026: A / B) · N-R7-S35: a volleyball team retiring at 2 sets all is scored
 * 3–2 the FIVB way (winner given the sets it needs, the retiring side keeps its own), so a league's
 * set-score points give 2 and 1, set columns 3–2. It went 2–2 in sets and 3 / 0 points.
 */
import { withRetirementSets } from '../utils/walkoverScore';
import { computeStats, type GMatch } from '../utils/standings';
import { standardRules } from '../utils/matchRules';

const VB = standardRules('volleyball');
const at22 = { A: { score: 2, sets: [25, 20, 25, 20], points: 9 }, B: { score: 2, sets: [20, 25, 20, 25], points: 6 }, retired: { side: 'B' } };

test('2–2 retired → 3–2 to the side that carried on; rallies as played', () => {
  const ss = withRetirementSets('volleyball', VB, at22, 'A');
  expect([ss.A.score, ss.B.score, ss.A.sets, ss.A.points, ss.retirement_sets]).toEqual([3, 2, [25, 20, 25, 20], 9, { A: 1 }]);
});

test('1–0 retired by the side ahead → 1–3; best of 3 → 2–x; every set played → the rest', () => {
  expect(withRetirementSets('volleyball', VB, { A: { score: 1 }, B: { score: 0 } }, 'B').B.score).toBe(3);
  expect(withRetirementSets('volleyball', { ...VB, bestOf: 3 }, { A: { score: 1 }, B: { score: 1 } }, 'A').A.score).toBe(2);
  const all = withRetirementSets('volleyball', { ...VB, allGames: true }, { A: { score: 2 }, B: { score: 1 } }, 'A');
  expect([all.A.score, all.B.score]).toEqual([4, 1]);
  const flat = withRetirementSets('volleyball', VB, { A: { score: 2 }, B: { score: 2 }, team_a_score: 2, team_b_score: 2 }, 'B');
  expect([flat.team_a_score, flat.team_b_score]).toEqual([2, 3]);
});

test('other sports and a series are left alone', () => {
  expect(withRetirementSets('badminton', standardRules('badminton'), { A: { score: 1 }, B: { score: 0 } }, 'A').A.score).toBe(1);
  expect(withRetirementSets('volleyball', VB, { A: { score: 1 }, B: { score: 1 }, tie: { series: true } }, 'A').A.score).toBe(1);
});

test('the league table: 2 and 1 points, sets 3–2', () => {
  const pts = { win: 3, draw: 1.5, loss: 0, sets: { straight: [3, 0] as [number, number], decider: [2, 1] as [number, number] } };
  const m: GMatch = { team_a_id: 'C1', team_b_id: 'C2', winner_team_id: 'C1', status: 'completed', score_summary: withRetirementSets('volleyball', VB, at22, 'A') } as GMatch;
  const s = computeStats(['C1', 'C2'], [m], undefined, pts as never);
  const c1 = s.get('C1')!; const c2 = s.get('C2')!;
  expect([c1.points, c1.scored, c1.conceded, c2.points, c2.scored, c2.conceded]).toEqual([2, 3, 2, 1, 2, 3]);
});
