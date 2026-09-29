/**
 * BUILD 3.20 · allow draws in a league / group match: on (standard) or off. Off,
 * a level football match goes to penalties like a knockout (no extra time).
 * Same table in both repos (shootoutRules and matchRules are byte-identical).
 */
import { shootoutApplies } from '../utils/shootoutRules';
import { rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';

test.each([
  ['football', true, true, true], ['football', false, true, false], ['football', false, false, true],
  ['hockey', false, false, true], ['cricket', false, false, false], ['football', true, false, true],
])('%s knockout=%s drawAllowed=%s → shootout %s', (sport, ko, draws, want) => {
  expect(shootoutApplies(sport as string, ko as boolean, draws as boolean)).toBe(want);
});
test('an on/off rule for football; the label says so', () => {
  expect(standardRules('football').drawAllowed).toBe(true);
  expect(rulesRefusal('football', { ...standardRules('football'), drawAllowed: false })).toBeNull();
  expect(rulesRefusal('football', { ...standardRules('football'), drawAllowed: 'no' })?.field).toBe('drawAllowed');
  expect(timedRulesLabel('football', { ...standardRules('football'), drawAllowed: false })).toBe('no draws');
  expect(rulesRefusal('basketball', { ...standardRules('basketball'), drawAllowed: true })?.field).toBe('drawAllowed');
});
