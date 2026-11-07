/**
 * N-R7-183 · Step 2 · Batch 8 · SPP1-CHS-099 (Dipak decided 7 Nov): the Armageddon decider assumed side A
 * had White. The arbiter draws the Armageddon's colours, so the sheet asks who has White and the
 * completion says so (`chess_tiebreak.white`); a draw goes to whoever had Black.
 */
import fs from 'fs';
import path from 'path';
import { armageddonWinner, armageddonAskWords, armageddonResultWords, chessTeamDeciderWords } from '../utils/chessRules';
import { isResultHow } from '../utils/qrHandoff';

test('the winner follows who had White', () => {
  expect(armageddonWinner('white', 'B')).toBe('B');
  expect(armageddonWinner('black', 'B')).toBe('A');
  expect(armageddonWinner('draw', 'B')).toBe('A');
  expect(armageddonWinner('white', 'A')).toBe('A');
  expect(armageddonWinner('draw', 'A')).toBe('B');
  expect(armageddonWinner('draw')).toBe('B'); // left out: side A had White, as before
});

test('the sheet asks who has White, then names the players', () => {
  const ask = armageddonAskWords(null, 'Arjun', 'Bala');
  expect(ask.title).toBe('Armageddon · who has White?');
  expect(ask.ask).toEqual({ A: 'Arjun has White', B: 'Bala has White' });
  const r = armageddonResultWords(null, 'Arjun', 'Bala', 'B');
  expect(r.result).toEqual({ white: 'Bala won with White · Bala goes through', black: 'Arjun won with Black · Arjun goes through', draw: 'Drawn · Arjun had Black · Arjun goes through' });
  expect(r.message).toBe('Bala has White and more time, Arjun has Black; a draw means Arjun goes through.');
  expect(armageddonResultWords('final', 'Arjun', 'Bala', 'A').result.draw).toBe('Drawn · Bala had Black · Bala wins the final');
  const team = armageddonAskWords('third_place', 'Knights', 'Rooks', true);
  expect(team.ask).toEqual({ A: "Knights's player has White", B: "Rooks's player has White" });
  expect(chessTeamDeciderWords(null, 'Knights', 'Rooks').choice).toBe('Armageddon game · one player from each team; a draw means the team with Black goes through');
});

test('a hand-over carries who had White', () => {
  expect(isResultHow({ side: 'B', ct: { method: 'armageddon', armageddon: 'white', white: 'B' } })).toBe(true);
  expect(isResultHow({ side: 'B', ct: { method: 'armageddon', armageddon: 'white', white: 'C' } })).toBe(false);
});

test('completeMatch checks the winner against who had White and stores it', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
  expect(src).toContain("const tbWhite: 'A' | 'B' = tbWhiteIn === 'B' ? 'B' : 'A';");
  expect(src).toContain('if (winnerSide && armageddonWinner(tbArmageddon, tbWhite) !== winnerSide) {');
  expect(src).toContain("code: 'BAD_CHESS_TIEBREAK'");
  expect(src).toContain("...(method === 'armageddon' ? { armageddon: tbArmageddon, white: tbWhite } : {}) };");
});
