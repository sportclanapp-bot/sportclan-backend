/** BUILD 3.69 · Armageddon / organiser's call on a drawn knockout chess game. */
import fs from 'fs';
import path from 'path';
import { armageddonWinner, chessTiebreakText } from '../utils/chessRules';

test('shared rule', () => {
  expect([armageddonWinner('white'), armageddonWinner('draw')]).toEqual(['A', 'B']);
  expect(chessTiebreakText('X', 'organiser')).toBe("X goes through (organiser's call)");
});
test('completion checks the Armageddon winner and records how', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
  expect(src).toContain("code: 'ARMAGEDDON_WINNER_MISMATCH'");
  expect(src).toContain("code: 'BAD_CHESS_TIEBREAK'");
  expect(src).toContain("ss.result = chessTiebreakText(derivedSide === 'A' ? aName : bName, method,");
});
