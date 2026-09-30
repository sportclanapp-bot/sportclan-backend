/** BUILD 3.73 · the carrom queen with no cut-off — the server counts it the same way. */
import { carromReplay } from '../utils/carromCore';
import { carromOptsOf, rulesRefusal, standardRules } from '../utils/matchRules';

test('the queen counts at 24 with the cut-off off', () => {
  const b = (w: 'A' | 'B', p: number, q = false) => ({ winner: w, piecesLeft: p, queen: q });
  const boards = [b('A', 9), b('A', 9), b('A', 6), b('A', 0, true)]; // 24, then a queen board
  expect(carromReplay(boards, carromOptsOf({ ...standardRules('carrom'), queenCutoff: false })).gamesWon.A).toBe(1); // 24 + 3
  expect(carromReplay(boards, carromOptsOf(standardRules('carrom'))).points.A).toBe(24); // official: no queen at 24
  expect(rulesRefusal('carrom', { ...standardRules('carrom'), queenPoints: 0 })).toBeNull();
});
