/**
 * Tennis scoring core — ONE rule for the app and the server.
 *
 * This file is byte-identical in both repos:
 *   app     src/scoring/tennisCore.ts
 *   server  src/utils/tennisCore.ts
 * and both repos run the same fixture table against it (tennisCore test), so the
 * two copies cannot drift without a test failing. (There is no shared package
 * between the repos; a copied file plus a shared fixture table is the honest
 * version of "one rule".) Edit both, or neither.
 *
 * Rules (ATP/WTA best of 3, standard tiebreak):
 *   game     first to 4 points, win by 2 (0 / 15 / 30 / 40 / deuce / advantage)
 *   set      first to 6 games, win by 2; at 6-6 a TIEBREAK decides it 7-6
 *   tiebreak first to 7 points, win by 2
 *   match    first to 2 sets (best of 3) — or 1 set, when the match's length
 *            preset is "1 set" (matchLength.ts); pass setsToWin.
 * A point after the match is decided changes nothing.
 *
 * Input is one event per POINT, carrying the side that won it — which is what
 * the app has always sent. The server used to read each of those as a GAME.
 */

export type TennisSide = 'A' | 'B';

export interface TennisSet {
  A: number;
  B: number;
  /** Present when the set was decided by a tiebreak: its points. */
  tiebreak?: { A: number; B: number };
}

export interface TennisScore {
  /** Points in the current game — or in the tiebreak, when `tiebreak` is true. */
  points: { A: number; B: number };
  /** Games in the current set. */
  games: { A: number; B: number };
  /** Completed sets, in order. */
  sets: TennisSet[];
  setsWon: { A: number; B: number };
  /** The current game is a tiebreak (the set is at 6-6). */
  tiebreak: boolean;
  winner: TennisSide | null;
}

export const TENNIS_SETS_TO_WIN = 2;
const GAMES_PER_SET = 6;
const TIEBREAK_TO = 7;

const other = (s: TennisSide): TennisSide => (s === 'A' ? 'B' : 'A');

export function emptyTennis(): TennisScore {
  return {
    points: { A: 0, B: 0 },
    games: { A: 0, B: 0 },
    sets: [],
    setsWon: { A: 0, B: 0 },
    tiebreak: false,
    winner: null,
  };
}

function winSet(s: TennisScore, side: TennisSide, setsToWin: number, tiebreak?: { A: number; B: number }): TennisScore {
  const set: TennisSet = { A: s.games.A, B: s.games.B };
  if (tiebreak) set.tiebreak = tiebreak;
  const setsWon = { ...s.setsWon, [side]: s.setsWon[side] + 1 };
  return {
    points: { A: 0, B: 0 },
    games: { A: 0, B: 0 },
    sets: [...s.sets, set],
    setsWon,
    tiebreak: false,
    winner: setsWon[side] >= setsToWin ? side : null,
  };
}

/** One point to `side`. Pure: returns a new score. */
export function tennisPoint(s: TennisScore, side: TennisSide, setsToWin: number = TENNIS_SETS_TO_WIN): TennisScore {
  if (s.winner) return s;
  const o = other(side);
  const points = { ...s.points, [side]: s.points[side] + 1 };

  if (s.tiebreak) {
    if (points[side] >= TIEBREAK_TO && points[side] - points[o] >= 2) {
      // The tiebreak winner takes the set 7-6.
      const games = { ...s.games, [side]: s.games[side] + 1 };
      return winSet({ ...s, games }, side, setsToWin, points);
    }
    return { ...s, points };
  }

  if (points[side] >= 4 && points[side] - points[o] >= 2) {
    const games = { ...s.games, [side]: s.games[side] + 1 };
    if (games[side] >= GAMES_PER_SET && games[side] - games[o] >= 2) {
      return winSet({ ...s, games }, side, setsToWin);
    }
    const tiebreak = games.A === GAMES_PER_SET && games.B === GAMES_PER_SET;
    return { ...s, points: { A: 0, B: 0 }, games, tiebreak };
  }
  return { ...s, points };
}

/** Replay a sequence of point winners from the start. */
export function tennisReplay(sides: TennisSide[], setsToWin: number = TENNIS_SETS_TO_WIN): TennisScore {
  let s = emptyTennis();
  for (const side of sides) s = tennisPoint(s, side, setsToWin);
  return s;
}

/** Games completed so far in the whole match (for the serve rotation). */
export function tennisGamesPlayed(s: TennisScore): number {
  return s.sets.reduce((n, x) => n + x.A + x.B, 0) + s.games.A + s.games.B;
}

const CALL = ['0', '15', '30', '40'];

/** How the current game reads: 15-30, deuce, advantage — or tiebreak numbers. */
export function tennisPointsDisplay(s: TennisScore): { a: string; b: string; status?: string } {
  const { A: a, B: b } = s.points;
  if (s.tiebreak) return { a: String(a), b: String(b), status: 'Tiebreak' };
  if (a >= 3 && b >= 3) {
    if (a === b) return { a: '40', b: '40', status: 'Deuce' };
    if (a === b + 1) return { a: 'Ad', b: '40', status: 'Advantage A' };
    if (b === a + 1) return { a: '40', b: 'Ad', status: 'Advantage B' };
  }
  return { a: CALL[Math.min(a, 3)] ?? '40', b: CALL[Math.min(b, 3)] ?? '40' };
}

/** "6–4", or "7–6 (7–5)" for a tiebreak set. */
export function tennisSetLabel(x: TennisSet): string {
  return x.tiebreak ? `${x.A}–${x.B} (${x.tiebreak.A}–${x.tiebreak.B})` : `${x.A}–${x.B}`;
}
