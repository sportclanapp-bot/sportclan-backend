/** BUILD 3.74 · carrom board cap — the server decides the capped game the same way. */
import { carromReplay } from '../utils/carromCore';
import { carromOptsOf, standardRules } from '../utils/matchRules';

test('8 boards: the side ahead takes it; level, an extra board', () => {
  const b = (w: 'A' | 'B', p: number) => ({ winner: w, piecesLeft: p, queen: false });
  const o = carromOptsOf({ ...standardRules('carrom'), boardCap: 8 });
  const eight = [b('A', 2), b('B', 2), b('A', 2), b('B', 2), b('A', 2), b('B', 2), b('A', 2), b('B', 1)];
  expect(carromReplay(eight, o).gamesWon.A).toBe(1); // 8–7
  const level = [...eight.slice(0, 7), b('B', 2)];
  expect(carromReplay(level, o).gamesWon).toEqual({ A: 0, B: 0 });
  expect(carromReplay([...level, b('B', 1)], o).gamesWon.B).toBe(1);
});
