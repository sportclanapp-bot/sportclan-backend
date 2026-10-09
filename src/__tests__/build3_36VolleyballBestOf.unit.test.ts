/** BUILD 3.36 · volleyball best of 1, 3 or 5 (standard 5). */
import { rulesRefusal, standardRules, rulesOf, winsToWin } from '../utils/matchRules';

test('1, 3 or 5; best of 1 is one set; "bo1" reads back', () => {
  for (const ok of [1, 3, 5]) expect(rulesRefusal('volleyball', { ...standardRules('volleyball'), bestOf: ok })).toBeNull();
  // Stage 13 · CR3: best of any odd number; an even one can't always find a winner.
  for (const ok of [7, 9]) expect(rulesRefusal('volleyball', { ...standardRules('volleyball'), bestOf: ok })).toBeNull();
  for (const bad of [0, 2, 4]) expect(rulesRefusal('volleyball', { ...standardRules('volleyball'), bestOf: bad })?.error).toBe('Match length must be best of an odd number (1, 3, 5, 7…).');
  expect(winsToWin({ v: 1, bestOf: 1 })).toBe(1);
  expect(rulesOf('volleyball', { format: 'bo1' }).bestOf).toBe(1);
});
