import { carromBoard, carromBoardPoints, carromPieces, carromReplay, emptyCarrom, CARROM_GAME_TARGET, CARROM_QUEEN_POINTS, CARROM_QUEEN_LIMIT, CARROM_MAX_PIECES } from '../utils/carromCore';
const CORE_REL = 'utils/carromCore.ts';
const OTHER_REPO = '../sportclan-v2';
const OTHER_CORE_REL = 'src/scoring/carromCore.ts';
/**
 * The shared carrom rule (decision A5), held to ONE fixture table in both repos.
 * carromCore.ts is byte-identical in the app and the server; this test body is
 * identical too (only the import path differs).
 */
import fs from 'fs';
import path from 'path';

type S = 'A' | 'B';
const board = (winner: S, piecesLeft: number, queen = false) => ({ winner, piecesLeft, queen });

describe('carromCore', () => {
  test('a board is worth the opponent\'s pieces left, plus 3 for a covered queen', () => {
    expect(carromBoardPoints(0, 5, false)).toBe(5);
    expect(carromBoardPoints(0, 5, true)).toBe(8);
  });

  test('the queen counts only while the winner is below 22', () => {
    expect(carromBoardPoints(21, 2, true)).toBe(5);
    expect(carromBoardPoints(22, 2, true)).toBe(2);
    expect(carromBoardPoints(24, 0, true)).toBe(0);
  });

  test('pieces left are whole pieces 0..9', () => {
    expect(carromPieces(12)).toBe(9);
    expect(carromPieces(-1)).toBe(0);
    expect(carromPieces('4')).toBe(4);
    expect(carromPieces(null)).toBe(0);
  });

  test('a game is first to 25 over as many boards as it takes', () => {
    // A: 9+3, 9+3 = 24 → not yet; then 3 (queen no longer counts at 24) → 27
    const s = carromReplay([board('A', 9, true), board('A', 9, true), board('A', 3, true)], 2);
    expect(s.gamesWon).toEqual({ A: 1, B: 0 });
    expect(s.games).toEqual([{ A: 27, B: 0 }]);
    expect(s.points).toEqual({ A: 0, B: 0 });
    expect(s.boards).toBe(0);
    expect(s.winner).toBeNull();
  });

  test('boards alternate; the side reaching 25 takes the game', () => {
    const s = carromReplay([board('A', 7), board('B', 9, true), board('A', 8), board('B', 6), board('A', 9, true)], 2);
    // A 7, B 12, A 15, B 18, A 15+9+3 = 27
    expect(s.games).toEqual([{ A: 27, B: 18 }]);
    expect(s.gamesWon.A).toBe(1);
  });

  test('best of 3 needs two games; "1 game" needs one', () => {
    const game = (w: S) => [board(w, 9, true), board(w, 9, true), board(w, 9)];
    expect(carromReplay([...game('A')], 1).winner).toBe('A');
    expect(carromReplay([...game('A')], 2).winner).toBeNull();
    expect(carromReplay([...game('A'), ...game('B'), ...game('A')], 2).winner).toBe('A');
  });

  test('a board after the match is decided changes nothing', () => {
    const game = [board('A', 9, true), board('A', 9, true), board('A', 9)];
    const decided = carromReplay(game, 1);
    expect(carromBoard(decided, board('B', 9, true), 1)).toBe(decided);
  });

  test('constants', () => {
    expect([CARROM_GAME_TARGET, CARROM_QUEEN_POINTS, CARROM_QUEEN_LIMIT, CARROM_MAX_PIECES]).toEqual([25, 3, 22, 9]);
    expect(emptyCarrom()).toEqual({ points: { A: 0, B: 0 }, boards: 0, games: [], gamesWon: { A: 0, B: 0 }, winner: null });
  });

  const here = path.join(__dirname, '..', CORE_REL);
  const there = path.join(__dirname, '..', '..', OTHER_REPO, OTHER_CORE_REL);
  (fs.existsSync(there) ? test : test.skip)('the app and server copies are identical', () => {
    expect(fs.readFileSync(here, 'utf8')).toBe(fs.readFileSync(there, 'utf8'));
  });
});
