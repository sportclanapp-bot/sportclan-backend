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
/** BUILD 3.72: the most a queen can be worth (the home game's 5). */
export const CARROM_QUEEN_MAX = 5;

/**
 * BUILD 3.72+ · a match's own carrom rules (matchRules.carromOptsOf). Anything
 * left out is the official game above. A bare number is the old argument:
 * games to win.
 */
export interface CarromOpts {
  gamesToWin: number;
  /** Points to win a game, 7–29. */
  target?: number;
  /** The queen's worth, 0–5 (3 official, 5 in the home game). */
  queenPoints?: number;
  /** The queen counts only while the winner is below target − queen (true, official), or always (false). */
  queenCutoff?: boolean;
}
type Opts = Required<CarromOpts>;
function optsOf(o: number | CarromOpts, target?: number): Opts {
  const x: CarromOpts = typeof o === 'number' ? { gamesToWin: o, target } : o;
  return { gamesToWin: x.gamesToWin, target: x.target ?? CARROM_GAME_TARGET, queenPoints: x.queenPoints ?? CARROM_QUEEN_POINTS, queenCutoff: x.queenCutoff ?? true };
}
/** The score below which the queen counts: target − queen (22 in the official game, 24 at home). */
export function carromQueenLimit(o: number | CarromOpts): number {
  const x = optsOf(o);
  return x.target - x.queenPoints;
}

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
export function carromBoardPoints(winnerScoreBefore: number, piecesLeft: number, queen: boolean, options?: CarromOpts): number {
  const o = optsOf(options ?? { gamesToWin: 1 });
  const counts = queen && (!o.queenCutoff || winnerScoreBefore < o.target - o.queenPoints);
  return carromPieces(piecesLeft) + (counts ? o.queenPoints : 0);
}

/**
 * One board. Pure: returns a new score. A board after the match is decided changes nothing.
 * BUILD 2.3: `target` is the match's points to win a game (its rules), 25 as standard.
 */
export function carromBoard(s: CarromScore, b: CarromBoardResult, options: number | CarromOpts, targetArg?: number): CarromScore {
  if (s.winner) return s;
  const o = optsOf(options, targetArg);
  const { gamesToWin, target } = o;
  const w = b.winner;
  const gained = carromBoardPoints(s.points[w], b.piecesLeft, b.queen, o);
  const points = { ...s.points, [w]: s.points[w] + gained };
  const boards = s.boards + 1;
  if (points[w] < target) return { ...s, points, boards };
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
export function carromReplay(boards: CarromBoardResult[], options: number | CarromOpts, target?: number): CarromScore {
  let s = emptyCarrom();
  for (const b of boards) s = carromBoard(s, b, options, target);
  return s;
}
