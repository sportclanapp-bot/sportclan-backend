/** BUILD 3.34 · basketball players a side, 1–5 (null = not set), shown as "3-a-side". */
import { rulesRefusal, standardRules, rulesOf, timedRulesLabel } from '../utils/matchRules';

test('null or whole 1 or more (Stage 13 · CR3: no top); older matches null', () => {
  const r = (players: unknown) => rulesRefusal('basketball', { ...standardRules('basketball'), players });
  expect(rulesOf('basketball', { format: 'basketball' }).players).toBeNull();
  for (const ok of [null, 1, 3, 5, 6, 12]) expect(r(ok)).toBeNull();
  for (const bad of [0, -1, 2.5]) expect(r(bad)?.error).toBe('Players a side must be a whole number, 1 or more.');
  expect(timedRulesLabel('basketball', { ...standardRules('basketball'), players: 3, targetScore: 21, pointSet: '12' })).toBe('3-a-side · first to 21 · 1s and 2s');
});
