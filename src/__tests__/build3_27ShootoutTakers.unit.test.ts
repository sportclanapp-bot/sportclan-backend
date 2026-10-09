/**
 * BUILD 3.27 · hockey shoot-out takers, 1–5 each before sudden death (standard
 * 5). The shootout check follows them: 3–1 after 3 each stands; 5–3 doesn't.
 */
import { shootoutKicksOf, validShootout } from '../utils/shootoutRules';
import { rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';

test('1 or more (Stage 13 · CR3: no top); standard 5; the label says a change', () => {
  expect(standardRules('hockey').shootoutTakers).toBe(5);
  for (const ok of [1, 3, 5, 6, 10]) expect(rulesRefusal('hockey', { ...standardRules('hockey'), shootoutTakers: ok })).toBeNull();
  for (const bad of [0, -1, 2.5]) expect(rulesRefusal('hockey', { ...standardRules('hockey'), shootoutTakers: bad })?.error).toBe('Shoot-out takers must be 1 or more each.');
  expect(timedRulesLabel('hockey', { ...standardRules('hockey'), shootoutTakers: 3 })).toBe('shoot-out 3 each');
  expect(rulesRefusal('football', { ...standardRules('football'), shootoutTakers: 3 })?.field).toBe('shootoutTakers');
});
test('the shootout check uses them', () => {
  const k = shootoutKicksOf({ shootoutTakers: 3 });
  expect(k).toBe(3);
  expect(validShootout(3, 1, k)).toBe(true);
  expect(validShootout(5, 3, k)).toBe(false);
  expect(shootoutKicksOf({ shootoutTakers: 1 })).toBe(1);
  expect(shootoutKicksOf({ shootoutTakers: 7 })).toBe(7); // Stage 13 · CR3: above the old top
  expect(shootoutKicksOf({ penaltyKicks: 3 })).toBe(3);
});
