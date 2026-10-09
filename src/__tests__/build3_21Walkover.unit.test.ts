/**
 * BUILD 3.21 · a football walkover goes down as 3–0 (standard) or 5–0, so it
 * counts in goal difference; other sports stay scoreless (4.8).
 */
import { rulesRefusal, standardRules, walkoverGoalsOf, timedRulesLabel } from '../utils/matchRules';
import { withWalkoverScore } from '../utils/walkoverScore';
import { computeStats } from '../utils/standings';

test('any whole number of goals to 0 (3–0 and 5–0 the usual; Stage 13 · CR3); standard 3', () => {
  expect(standardRules('football').walkoverGoals).toBe(3);
  for (const ok of [1, 4, 5, 10]) expect(rulesRefusal('football', { ...standardRules('football'), walkoverGoals: ok })).toBeNull();
  for (const bad of [0, -1, 3.5]) expect(rulesRefusal('football', { ...standardRules('football'), walkoverGoals: bad })?.error).toBe('A walkover is a whole number of goals to 0 (3–0 and 5–0 are the usual).');
  expect(walkoverGoalsOf('football', { v: 1, walkoverGoals: 5 })).toBe(5);
  expect(walkoverGoalsOf('football', { v: 1 })).toBe(3);
  expect(walkoverGoalsOf('hockey', standardRules('hockey'))).toBeNull();
  expect(timedRulesLabel('football', { ...standardRules('football'), walkoverGoals: 5 })).toBe('walkover 5–0');
});
test('the summary: the winner’s goals, 0 for the other', () => {
  expect(withWalkoverScore('football', { v: 1, walkoverGoals: 5 }, { walkover: true }, 'B')).toMatchObject({ A: { score: 0 }, B: { score: 5 }, walkover_score: { A: 0, B: 5 } });
  expect(withWalkoverScore('hockey', standardRules('hockey'), { walkover: true }, 'A')).toEqual({ walkover: true });
});
test('goal difference counts it', () => {
  const m = { id: 'm', team_a_id: 'a', team_b_id: 'b', status: 'abandoned', winner_team_id: 'a', score_summary: withWalkoverScore('football', { v: 1 }, {}, 'A') };
  const table = computeStats(['a', 'b'], [m] as never);
  expect(table.get('a')).toMatchObject({ won: 1, scored: 3, conceded: 0, diff: 3 });
  expect(table.get('b')).toMatchObject({ lost: 1, diff: -3 });
});
