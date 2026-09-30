/** BUILD 3.64 · tennis best of 5. */
import { bestOfFor, isAcceptableMatchLength } from '../utils/matchLength';
import { standardRules, tennisOptsOf } from '../utils/matchRules';
import { tennisReplay } from '../utils/tennisCore';

test('bo5 offered; the server needs three sets', () => {
  expect(isAcceptableMatchLength('tennis', 'bo5')).toBe(true);
  expect(bestOfFor('tennis', 'bo5')).toBe(5);
  const o = tennisOptsOf({ ...standardRules('tennis'), bestOf: 5 });
  expect(tennisReplay(Array.from({ length: 48 }, () => 'A' as const), o).winner).toBeNull();
  expect(tennisReplay(Array.from({ length: 72 }, () => 'A' as const), o).winner).toBe('A');
});
