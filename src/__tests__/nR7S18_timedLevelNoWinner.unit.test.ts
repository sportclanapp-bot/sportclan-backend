/** N-R7-S18 · a timed rally match left level at the buzzer ("stays level") can't be completed as a win. */
import fs from 'fs';
import path from 'path';
import { levelAtTime } from '../controllers/matches.controller';

test('a level-at-time summary is a draw; a timed win or an untimed match is not', () => {
  expect(levelAtTime({ timed_level: true })).toBe(true);
  expect(levelAtTime({})).toBe(false);
  expect(levelAtTime(null)).toBe(false);
});
test('completeMatch refuses a named winner on it', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
  expect(src).toContain("if (bo && bo.decided && levelAtTime(canonical) && winnerSide) {");
  expect(src).toContain("code: 'TIMED_LEVEL'");
});
