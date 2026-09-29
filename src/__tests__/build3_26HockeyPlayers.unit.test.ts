/** BUILD 3.26 · hockey players a side, 4–11 (null = not set), shown as "7-a-side". */
import { rulesRefusal, standardRules, rulesOf, timedRulesLabel } from '../utils/matchRules';

test('null or whole 4–11; older matches null', () => {
  const r = (players: unknown) => rulesRefusal('hockey', { ...standardRules('hockey'), players });
  expect(rulesOf('hockey', { format: 'hockey' }).players).toBeNull();
  for (const ok of [null, 4, 5, 11]) expect(r(ok)).toBeNull();
  for (const bad of [3, 12, 5.5]) expect(r(bad)?.error).toBe('Players a side must be a whole number from 4 to 11.');
  expect(timedRulesLabel('hockey', { ...standardRules('hockey'), players: 5, periods: 2, periodMinutes: 10 })).toBe('5-a-side · 2 × 10 min');
});
