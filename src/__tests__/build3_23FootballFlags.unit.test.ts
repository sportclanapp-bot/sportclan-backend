/**
 * BUILD 3.23 · rolling subs and offside — football flags shown on the match
 * (label), no effect on scoring. Standard: no rolling subs, offside on.
 */
import { rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';

test('on/off; the Laws by default; said only when they differ', () => {
  expect(standardRules('football')).toMatchObject({ rollingSubs: false, offside: true });
  expect(rulesRefusal('football', { ...standardRules('football'), rollingSubs: true, offside: false })).toBeNull();
  expect(rulesRefusal('football', { ...standardRules('football'), offside: 'no' })?.field).toBe('offside');
  expect(timedRulesLabel('football', standardRules('football'))).toBeNull();
  expect(timedRulesLabel('football', { ...standardRules('football'), players: 5, rollingSubs: true, offside: false })).toBe('5-a-side · rolling subs · no offside');
});
