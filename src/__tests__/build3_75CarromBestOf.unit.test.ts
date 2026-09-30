/** BUILD 3.75 · carrom best of 5. */
import { bestOfFor, isAcceptableMatchLength } from '../utils/matchLength';
import { carromReplay } from '../utils/carromCore';
import { carromOptsOf, standardRules } from '../utils/matchRules';

test('bo5 offered; the server needs three games', () => {
  expect(isAcceptableMatchLength('carrom', 'bo5')).toBe(true);
  expect(bestOfFor('carrom', 'bo5')).toBe(5);
  const b = { winner: 'A' as const, piecesLeft: 9, queen: true };
  const o = carromOptsOf({ ...standardRules('carrom'), bestOf: 5 });
  expect(carromReplay(Array.from({ length: 6 }, () => b), o).winner).toBeNull();
  expect(carromReplay(Array.from({ length: 9 }, () => b), o).winner).toBe('A');
});
