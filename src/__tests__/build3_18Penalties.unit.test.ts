/**
 * BUILD 3.18 · football penalties: 3 or 5 kicks each, then sudden death. A
 * tally past the kicks went to sudden death, so it ends by exactly one. Same
 * table in both repos (shootoutRules is byte-identical).
 */
import { shootoutKicksOf, shootoutProblem, validShootout } from '../utils/shootoutRules';
import { rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';

test.each([
  [3, 0, 3, true], [2, 1, 3, true], [4, 3, 3, true], [5, 4, 3, true], [5, 3, 3, false], [6, 4, 3, false],
  [5, 3, 5, true], [6, 5, 5, true], [6, 4, 5, false], [3, 3, 5, false], [7, 3, null, true],
])('%i–%i with %s each → %s', (a, b, kicks, ok) => {
  expect(validShootout(a, b, kicks)).toBe(ok);
});
test('the words', () => {
  expect(shootoutProblem(5, 3, 3)).toBe('After 3 kicks each it’s sudden death, so it ends by one goal (e.g. 4–3).');
  expect(shootoutProblem(2, 2, 5)).toBe('A shootout can’t end level.');
});
test('football: 3 or 5, standard 5; the label says 3', () => {
  expect(standardRules('football').penaltyKicks).toBe(5);
  expect(shootoutKicksOf(standardRules('football'))).toBe(5);
  expect(shootoutKicksOf({ penaltyKicks: 3 })).toBe(3);
  expect(shootoutKicksOf(standardRules('hockey'))).toBe(5);
  expect(rulesRefusal('football', { ...standardRules('football'), penaltyKicks: 4 })?.error).toBe('Penalty kicks must be 3 or 5 each.');
  expect(timedRulesLabel('football', { ...standardRules('football'), penaltyKicks: 3 })).toBe('3 pens each');
});
