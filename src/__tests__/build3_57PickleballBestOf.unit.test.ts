/** BUILD 3.57 · pickleball best of 1, 3 or 5. */
import { bestOfFor, isAcceptableMatchLength } from '../utils/matchLength';
import { rulesRefusal, standardRules } from '../utils/matchRules';

test('bo5 offered and read back', () => {
  expect(isAcceptableMatchLength('pickleball', 'bo5')).toBe(true);
  expect(bestOfFor('pickleball', 'bo5')).toBe(5);
  expect(rulesRefusal('pickleball', { ...standardRules('pickleball'), bestOf: 5 })).toBeNull();
  expect(isAcceptableMatchLength('pickleball', 'bo7')).toBe(false);
});
