/**
 * BUILD 3.29 · hockey card suspensions: green 2 minutes, yellow 5–10 (standard
 * 5); a red has no timer. Football's yellow is its sin bin (3.24), if set.
 */
import { cardSuspensions, rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';

test('yellow 1 or more (Stage 13 · CR3: no top); standard 5; the label says a change', () => {
  expect(standardRules('hockey').yellowCardMinutes).toBe(5);
  for (const ok of [1, 4, 5, 8, 10, 11, 30]) expect(rulesRefusal('hockey', { ...standardRules('hockey'), yellowCardMinutes: ok })).toBeNull();
  for (const bad of [0, -1, 6.5]) expect(rulesRefusal('hockey', { ...standardRules('hockey'), yellowCardMinutes: bad })?.error).toBe('A yellow card suspends for a whole number of minutes.');
  expect(timedRulesLabel('hockey', { ...standardRules('hockey'), yellowCardMinutes: 10 })).toBe('yellow 10 min');
});
test('what each card suspends for, per sport', () => {
  expect(cardSuspensions('hockey', standardRules('hockey'))).toEqual({ green: 2, yellow: 5 });
  expect(cardSuspensions('hockey', { ...standardRules('hockey'), yellowCardMinutes: 10 })).toEqual({ green: 2, yellow: 10 });
  expect(cardSuspensions('football', standardRules('football'))).toEqual({});
  expect(cardSuspensions('football', { ...standardRules('football'), sinBinMinutes: 10 })).toEqual({ yellow: 10 });
  expect(cardSuspensions('basketball', standardRules('basketball'))).toEqual({});
});
