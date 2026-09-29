/** BUILD 3.36 · volleyball best of 1, 3 or 5 (standard 5). */
import { rulesRefusal, standardRules, rulesOf, winsToWin } from '../utils/matchRules';

test('1, 3 or 5; best of 1 is one set; "bo1" reads back', () => {
  for (const ok of [1, 3, 5]) expect(rulesRefusal('volleyball', { ...standardRules('volleyball'), bestOf: ok })).toBeNull();
  expect(rulesRefusal('volleyball', { ...standardRules('volleyball'), bestOf: 7 })?.field).toBe('bestOf');
  expect(winsToWin({ v: 1, bestOf: 1 })).toBe(1);
  expect(rulesOf('volleyball', { format: 'bo1' }).bestOf).toBe(1);
});
