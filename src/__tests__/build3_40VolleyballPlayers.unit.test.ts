/** BUILD 3.40 · volleyball players a side, 2–9 (null = not set), shown as "6-a-side". */
import { rulesRefusal, standardRules, rulesOf, timedRulesLabel } from '../utils/matchRules';

test('null or whole 1 or more (Stage 13 · CR3: no top); older matches null; the label', () => {
  const r = (players: unknown) => rulesRefusal('volleyball', { ...standardRules('volleyball'), players });
  expect(rulesOf('volleyball', { format: 'bo5' }).players).toBeNull();
  for (const ok of [null, 1, 2, 6, 9, 10, 12]) expect(r(ok)).toBeNull();
  for (const bad of [0, -1, 2.5]) expect(r(bad)?.error).toBe('Players a side must be a whole number, 1 or more.');
  expect(timedRulesLabel('volleyball', { ...standardRules('volleyball'), players: 6 })).toBe('6-a-side');
  expect(rulesRefusal('badminton', { ...standardRules('badminton'), players: 3 })?.field).toBe('players'); // BUILD 3.47: 2 is doubles
});
