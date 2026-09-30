/** BUILD 3.76 · a timed carrom game — the server replays time called. */
import fs from 'fs';
import path from 'path';
import { carromReplay } from '../utils/carromCore';

test('the leader takes the game when time is called', () => {
  const b = (w: 'A' | 'B', p: number) => ({ winner: w, piecesLeft: p, queen: false });
  expect(carromReplay([b('A', 5), b('B', 3), { buzzer: true }], 2).gamesWon.A).toBe(1);
  const src = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(src).toContain("if (e.event_type === 'note') return { buzzer: true as const };");
  expect(src).toContain("slug === 'carrom' ? !!rulesOf(slug, match).gameMinutes : false;");
});
