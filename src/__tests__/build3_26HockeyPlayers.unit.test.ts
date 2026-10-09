/** BUILD 3.26 · hockey players a side, 4–11 (null = not set), shown as "7-a-side". */
import { rulesRefusal, standardRules, rulesOf, timedRulesLabel } from '../utils/matchRules';

test('null or whole 1 or more (Stage 13 · CR3: no top); older matches null', () => {
  const r = (players: unknown) => rulesRefusal('hockey', { ...standardRules('hockey'), players });
  expect(rulesOf('hockey', { format: 'hockey' }).players).toBeNull();
  for (const ok of [null, 1, 3, 4, 5, 11, 12]) expect(r(ok)).toBeNull();
  for (const bad of [0, -1, 5.5]) expect(r(bad)?.error).toBe('Players a side must be a whole number, 1 or more.');
  expect(timedRulesLabel('hockey', { ...standardRules('hockey'), players: 5, periods: 2, periodMinutes: 10 })).toBe('5-a-side · 2 × 10 min');
});
