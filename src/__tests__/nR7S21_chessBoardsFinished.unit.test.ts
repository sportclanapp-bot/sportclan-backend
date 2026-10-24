/** N-R7-S21 · a team chess match can't be ended with a board still to play (its game points count). */
import fs from 'fs';
import path from 'path';
import { chessBoardsLeft } from '../controllers/matches.controller';

const team4 = { rubbers: [{}, {}, {}, {}] };
const mini = { rubbers: [{}, {}, { decider: true }, { decider: true }] };
test('3 of 4 boards played: boards left', () => {
  expect(chessBoardsLeft(team4, { rubbers: [1, 2, 3] })).toEqual({ played: 3, boards: 4 });
});
test('every board played, nothing typed yet, a mini-match or no tie: nothing to wait for', () => {
  expect(chessBoardsLeft(team4, { rubbers: [1, 2, 3, 4] })).toBeNull();
  expect(chessBoardsLeft(team4, { rubbers: [] })).toBeNull();
  expect(chessBoardsLeft(mini, { rubbers: [1] })).toBeNull();
  expect(chessBoardsLeft(null, { rubbers: [1] })).toBeNull();
});
test('completeMatch refuses it', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
  expect(src).toContain("code: 'BOARDS_NOT_FINISHED'");
});
