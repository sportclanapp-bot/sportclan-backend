/**
 * Carrom scoring core — ONE rule for the app and the server (decision A5).
 *
 * This file is byte-identical in both repos:
 *   app     src/scoring/carromCore.ts
 *   server  src/utils/carromCore.ts
 * and both repos run the same fixture table against it (carromCore test), so the
 * two copies cannot drift without a test failing. Edit both, or neither.
 *
 * Real (ICF-style) rules, as carrom players know them:
 *   board   played until one side pockets all of theirs. The board's winner
 *           scores the pieces the opponent still has on the board (0–9), plus
 *           3 for the queen if the winner covered it — but the queen only
 *           counts while the winner's game score is below 22.
 *   game    first to 25 points, over as many boards as it takes.
 *   match   best of 1 or 3 games (the match's length preset, matchLength.ts).
 *
 * Input is one event per BOARD: { winner, piecesLeft, queen }.
 */

export type CarromSide = 'A' | 'B';

export const CARROM_GAME_TARGET = 25;
export const CARROM_QUEEN_POINTS = 3;
/** The queen scores only while the winner's game score is below this. */
export const CARROM_QUEEN_LIMIT = 22;
export const CARROM_MAX_PIECES = 9;

export interface CarromBoardResult {
  winner: CarromSide;
  /** The opponent's pieces still on the board, 0–9. */
  piecesLeft: number;
  /** Did the board's winner cover the queen? */
  queen: boolean;
}

export interface CarromScore {
  /** Points in the current game. */
  points: { A: number; B: number };
  /** Boards played in the current game. */
  boards: number;
  /** Completed games' final scores, in order. */
  games: Array<{ A: number; B: number }>;
  gamesWon: { A: number; B: number };
  winner: CarromSide | null;
}

export function emptyCarrom(): CarromScore {
  return { points: { A: 0, B: 0 }, boards: 0, games: [], gamesWon: { A: 0, B: 0 }, winner: null };
}

/** Clamp a pieces-left value into 0..9 (whole pieces). */
export function carromPieces(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 0) return 0;
  return v > CARROM_MAX_PIECES ? CARROM_MAX_PIECES : v;
}

/** What a board is worth to its winner, given the winner's game score before it. */
export function carromBoardPoints(winnerScoreBefore: number, piecesLeft: number, queen: boolean): number {
  const queenPts = queen && winnerScoreBefore < CARROM_QUEEN_LIMIT ? CARROM_QUEEN_POINTS : 0;
  return carromPieces(piecesLeft) + queenPts;
}

/** One board. Pure: returns a new score. A board after the match is decided changes nothing. */
export function carromBoard(s: CarromScore, b: CarromBoardResult, gamesToWin: number): CarromScore {
  if (s.winner) return s;
  const w = b.winner;
  const gained = carromBoardPoints(s.points[w], b.piecesLeft, b.queen);
  const points = { ...s.points, [w]: s.points[w] + gained };
  const boards = s.boards + 1;
  if (points[w] < CARROM_GAME_TARGET) return { ...s, points, boards };
  // Game over: the board's winner took it.
  const gamesWon = { ...s.gamesWon, [w]: s.gamesWon[w] + 1 };
  return {
    points: { A: 0, B: 0 },
    boards: 0,
    games: [...s.games, points],
    gamesWon,
    winner: gamesWon[w] >= gamesToWin ? w : null,
  };
}

/** Replay a match from its boards. */
export function carromReplay(boards: CarromBoardResult[], gamesToWin: number): CarromScore {
  let s = emptyCarrom();
  for (const b of boards) s = carromBoard(s, b, gamesToWin);
  return s;
}
