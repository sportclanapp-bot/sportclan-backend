/** BUILD 3.72 · carrom target and queen value — the server replays with the match's rules. */
import fs from 'fs';
import path from 'path';
import { carromReplay } from '../utils/carromCore';
import { carromOptsOf, standardRules } from '../utils/matchRules';

test('a home game to 29 with the queen +5', () => {
  const o = carromOptsOf({ ...standardRules('carrom'), target: 29, queenPoints: 5 });
  const b = (w: 'A' | 'B', p: number, q = false) => ({ winner: w, piecesLeft: p, queen: q });
  expect(carromReplay([b('A', 9, true), b('A', 9, true)], o).points.A).toBe(28);
  expect(carromReplay([b('A', 9, true), b('A', 9, true), b('A', 1)], o).gamesWon.A).toBe(1);
  const src = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(src).toContain("carromOptsOf(rulesOf('carrom', match)), // BUILD 2.3 / 3.72+");
  expect(src).toContain('CARROM_MAX_PIECES + CARROM_QUEEN_MAX');
});
