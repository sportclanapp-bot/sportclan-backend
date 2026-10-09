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
/** BUILD 3.72: the most a queen can be worth. Stage 13 · CR3 (Dipak): no top — the match's own number. */
export const CARROM_QUEEN_MAX = Number.MAX_SAFE_INTEGER;

/**
 * BUILD 3.72+ · a match's own carrom rules (matchRules.carromOptsOf). Anything
 * left out is the official game above. A bare number is the old argument:
 * games to win.
 */
export interface CarromOpts {
  gamesToWin: number;
  /** Points to win a game, 1 or more (Stage 13 · CR3: no top). */
  target?: number;
  /** The queen's worth, 0 or more (3 official, 5 in the home game). */
  queenPoints?: number;
  /** The queen counts only while the winner is below target − queen (true, official), or always (false). */
  queenCutoff?: boolean;
  /**
   * BUILD 3.74: boards a game, 1–12 (ICF: 8), or null for none. At the cap the
   * side ahead takes the game; level, extra boards until one side leads.
   */
  boardCap?: number | null;
  /** BUILD 3.76: a timed game's minutes — for the pad's TIME CALLED; the core only reads the buzzer. */
  gameMinutes?: number | null;
}
type Opts = Required<CarromOpts>;
function optsOf(o: number | CarromOpts, target?: number): Opts {
  const x: CarromOpts = typeof o === 'number' ? { gamesToWin: o, target } : o;
  return { gamesToWin: x.gamesToWin, target: x.target ?? CARROM_GAME_TARGET, queenPoints: x.queenPoints ?? CARROM_QUEEN_POINTS, queenCutoff: x.queenCutoff ?? true, boardCap: x.boardCap ?? null, gameMinutes: x.gameMinutes ?? null };
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
  /** BUILD 3.76: time has been called in the game in play (a timed game). */
  timeUp?: boolean;
}

/** BUILD 3.76: a board, or time called in a timed game. */
export type CarromItem = CarromBoardResult | { buzzer: true };

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
  // BUILD 3.74: at the board cap (or on an extra board after it), the side ahead takes the game.
  // BUILD 3.76: likewise once time is called in a timed game.
  const capped = ((o.boardCap != null && boards >= o.boardCap) || s.timeUp === true) && points.A !== points.B;
  if (points[w] < target && !capped) return { ...s, points, boards };
  // Game over: the board's winner took it — or, at the cap, whoever leads.
  const gw: CarromSide = points[w] >= target ? w : points.A > points.B ? 'A' : 'B';
  const gamesWon = { ...s.gamesWon, [gw]: s.gamesWon[gw] + 1 };
  return {
    points: { A: 0, B: 0 },
    boards: 0,
    games: [...s.games, points],
    gamesWon,
    winner: gamesWon[gw] >= gamesToWin ? gw : null,
  };
}

/**
 * BUILD 3.76 · time called in the game in play: the side ahead on points takes
 * it; level, the next board that puts a side ahead does (carromBoard).
 */
export function carromTimeUp(s: CarromScore, options: number | CarromOpts, targetArg?: number): CarromScore {
  if (s.winner || s.timeUp) return s;
  if (s.points.A === s.points.B) return { ...s, timeUp: true };
  const o = optsOf(options, targetArg);
  const gw: CarromSide = s.points.A > s.points.B ? 'A' : 'B';
  const gamesWon = { ...s.gamesWon, [gw]: s.gamesWon[gw] + 1 };
  return { points: { A: 0, B: 0 }, boards: 0, games: [...s.games, s.points], gamesWon, winner: gamesWon[gw] >= o.gamesToWin ? gw : null };
}

/** Replay a match from its boards (BUILD 3.76: and any time called). */
export function carromReplay(items: CarromItem[], options: number | CarromOpts, target?: number): CarromScore {
  let s = emptyCarrom();
  for (const b of items) s = 'buzzer' in b ? carromTimeUp(s, options, target) : carromBoard(s, b, options, target);
  return s;
}

// ─── BUILD 3.77 · point carrom ──────────────────────────────────────────────
//
// The home game where every pocketed piece scores for whoever pockets it:
// white 10, black 5, the queen 25 or 50. A board is over when all 19 are down
// (9 white, 9 black, the queen) and the higher total takes the game; level,
// the side that pocketed the queen takes it. Input is one event per piece.

export const POINT_CARROM = { white: 10, black: 5, whites: 9, blacks: 9 } as const;
export type PointCoin = 'white' | 'black' | 'queen';

export interface PointCarromOpts {
  gamesToWin: number;
  /** 25 or 50. */
  queenValue: number;
}

export interface PointCarromScore {
  points: { A: number; B: number };
  /** Pieces still on the board in the game in play. */
  left: { white: number; black: number; queen: number };
  /** Who pocketed the queen this game (the tie-break), if anyone. */
  queenBy: CarromSide | null;
  games: Array<{ A: number; B: number }>;
  gamesWon: { A: number; B: number };
  winner: CarromSide | null;
}

const freshBoard = () => ({ white: POINT_CARROM.whites, black: POINT_CARROM.blacks, queen: 1 });

export function emptyPointCarrom(): PointCarromScore {
  return { points: { A: 0, B: 0 }, left: freshBoard(), queenBy: null, games: [], gamesWon: { A: 0, B: 0 }, winner: null };
}

/** What a piece is worth. */
export function pointCoinValue(coin: PointCoin, queenValue: number): number {
  return coin === 'white' ? POINT_CARROM.white : coin === 'black' ? POINT_CARROM.black : queenValue;
}

/** One piece pocketed by `side`. A piece that's no longer on the board — or after the match — changes nothing. */
export function pointCarromPocket(s: PointCarromScore, side: CarromSide, coin: PointCoin, o: PointCarromOpts): PointCarromScore {
  if (s.winner || s.left[coin] <= 0) return s;
  const points = { ...s.points, [side]: s.points[side] + pointCoinValue(coin, o.queenValue) };
  const left = { ...s.left, [coin]: s.left[coin] - 1 };
  const queenBy = coin === 'queen' ? side : s.queenBy;
  if (left.white + left.black + left.queen > 0) return { ...s, points, left, queenBy };
  const gw: CarromSide = points.A !== points.B ? (points.A > points.B ? 'A' : 'B') : queenBy ?? side;
  const gamesWon = { ...s.gamesWon, [gw]: s.gamesWon[gw] + 1 };
  return { points: { A: 0, B: 0 }, left: freshBoard(), queenBy: null, games: [...s.games, points], gamesWon, winner: gamesWon[gw] >= o.gamesToWin ? gw : null };
}

export function pointCarromReplay(pockets: ReadonlyArray<{ side: CarromSide; coin: PointCoin }>, o: PointCarromOpts): PointCarromScore {
  let s = emptyPointCarrom();
  for (const p of pockets) s = pointCarromPocket(s, p.side, p.coin, o);
  return s;
}
