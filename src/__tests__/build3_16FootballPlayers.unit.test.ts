/**
 * BUILD 3.16 · football players a side, 3–11 (null = not set): stored in the
 * rules, shown as "7-a-side"; the line-up isn't limited by it (rolling subs).
 */
import { rulesRefusal, standardRules, rulesOf, timedRulesLabel } from '../utils/matchRules';

test('null or whole 3–11; older matches null', () => {
  const r = (players: unknown) => rulesRefusal('football', { ...standardRules('football'), players });
  expect(standardRules('football').players).toBeNull();
  expect(rulesOf('football', { format: 'football' }).players).toBeNull();
  for (const ok of [null, 3, 5, 7, 11]) expect(r(ok)).toBeNull();
  for (const bad of [2, 12, 6.5, '7']) expect(r(bad)?.field).toBe('players');
  expect(r(12)?.error).toBe('Players a side must be a whole number from 3 to 11.');
});
test('shown as "7-a-side"; nothing when not set; not for other sports', () => {
  expect(timedRulesLabel('football', { ...standardRules('football'), players: 7 })).toBe('7-a-side');
  expect(timedRulesLabel('football', standardRules('football'))).toBeNull();
  expect(timedRulesLabel('cricket', { ...standardRules('cricket'), players: 7 })).toBeNull();
  expect(rulesRefusal('hockey', { ...standardRules('hockey'), players: 7 })).toBeNull(); // hockey's too since 3.26
});
