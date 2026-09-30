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
  /** BUILD 3.62: the tiebreak in play is the match tiebreak that replaces the final set. */
  matchTiebreak?: boolean;
  winner: TennisSide | null;
}

export const TENNIS_SETS_TO_WIN = 2;
const GAMES_PER_SET = 6;
const TIEBREAK_TO = 7;

/**
 * BUILD 3.59+ · a match's own tennis rules (the match's rules, via
 * matchRules.tennisOptsOf). Anything left out is the standard above. A bare
 * number is the old argument: sets to win.
 */
export interface TennisOpts {
  setsToWin: number;
  /** BUILD 3.59: games to win a set, 4–10 (short set to pro set); the tiebreak comes at games-all. */
  gamesPerSet?: number;
  /** BUILD 3.60: a tiebreak at games-all (standard), or none — an advantage set, won 2 games clear. */
  tiebreak?: boolean;
  /** BUILD 3.61: tiebreak to 7 (standard) or 10 points, win by 2. */
  tiebreakTo?: number;
  /** BUILD 3.62: the final set is a match tiebreak to 10 (win by 2), recorded as a 1–0 set. */
  matchTiebreak?: boolean;
  /**
   * BUILD 3.63: games — 'ad' (standard: deuce and advantage), 'noad' (at
   * 40-all the next point wins), 'semiad' (one advantage; at the second deuce
   * the next point wins).
   */
  scoring?: TennisGameScoring;
}
export type TennisGameScoring = 'ad' | 'noad' | 'semiad';
type Opts = Required<TennisOpts>;
function optsOf(o: number | TennisOpts | undefined): Opts {
  const x: TennisOpts = typeof o === 'number' ? { setsToWin: o } : o ?? { setsToWin: TENNIS_SETS_TO_WIN };
  return { setsToWin: x.setsToWin, gamesPerSet: x.gamesPerSet ?? GAMES_PER_SET, tiebreak: x.tiebreak ?? true, tiebreakTo: x.tiebreakTo ?? TIEBREAK_TO, matchTiebreak: x.matchTiebreak ?? false, scoring: x.scoring ?? 'ad' };
}

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

function winSet(s: TennisScore, side: TennisSide, setsToWin: number, tiebreak?: { A: number; B: number }, matchTiebreak = false): TennisScore {
  const set: TennisSet = { A: s.games.A, B: s.games.B };
  if (tiebreak) set.tiebreak = tiebreak;
  const setsWon = { ...s.setsWon, [side]: s.setsWon[side] + 1 };
  const winner = setsWon[side] >= setsToWin ? side : null;
  // BUILD 3.62: sets level going into the final set — it is a match tiebreak.
  const mtb = !winner && matchTiebreak && setsToWin > 1 && setsWon.A === setsToWin - 1 && setsWon.B === setsToWin - 1;
  return {
    points: { A: 0, B: 0 },
    games: { A: 0, B: 0 },
    sets: [...s.sets, set],
    setsWon,
    tiebreak: mtb,
    ...(mtb ? { matchTiebreak: true } : {}),
    winner,
  };
}

/** BUILD 3.62: the match tiebreak's points. */
const MATCH_TIEBREAK_TO = 10;

/** One point to `side`. Pure: returns a new score. */
export function tennisPoint(s: TennisScore, side: TennisSide, options: number | TennisOpts = TENNIS_SETS_TO_WIN): TennisScore {
  if (s.winner) return s;
  const { setsToWin, gamesPerSet, tiebreak: tiebreaks, tiebreakTo, matchTiebreak, scoring } = optsOf(options);
  const o = other(side);
  const points = { ...s.points, [side]: s.points[side] + 1 };

  if (s.tiebreak) {
    const to = s.matchTiebreak ? MATCH_TIEBREAK_TO : tiebreakTo;
    if (points[side] >= to && points[side] - points[o] >= 2) {
      // The tiebreak winner takes the set 7-6 (a match tiebreak: 1-0).
      const games = { ...s.games, [side]: s.games[side] + 1 };
      return winSet({ ...s, games }, side, setsToWin, points, matchTiebreak);
    }
    return { ...s, points };
  }

  if (gameWon(points[side], points[o], scoring)) {
    const games = { ...s.games, [side]: s.games[side] + 1 };
    if (games[side] >= gamesPerSet && games[side] - games[o] >= 2) {
      return winSet({ ...s, games }, side, setsToWin, undefined, matchTiebreak);
    }
    const tiebreak = tiebreaks && games.A === gamesPerSet && games.B === gamesPerSet;
    return { ...s, points: { A: 0, B: 0 }, games, tiebreak };
  }
  return { ...s, points };
}

/** BUILD 3.63: has a side with `a` points (the other `b`) won the game? */
function gameWon(a: number, b: number, scoring: TennisGameScoring): boolean {
  if (a >= 4 && a - b >= 2) return true;
  if (scoring === 'noad') return a >= 4 && a > b; // 4-3: the deciding point at 40-all
  if (scoring === 'semiad') return a >= 5 && a + b >= 9; // 5-4: the deciding point at the second deuce
  return false;
}

/** Replay a sequence of point winners from the start. */
export function tennisReplay(sides: TennisSide[], options: number | TennisOpts = TENNIS_SETS_TO_WIN): TennisScore {
  let s = emptyTennis();
  for (const side of sides) s = tennisPoint(s, side, options);
  return s;
}

/**
 * BUILD 3.66 · a timed match, scored at the buzzer: who leads — on sets, then
 * games in the set in play, then points in the game in play. Null when level
 * on all three (the next point decides).
 */
export function tennisLeader(s: TennisScore): TennisSide | null {
  if (s.winner) return s.winner;
  for (const k of ['setsWon', 'games', 'points'] as const) {
    if (s[k].A !== s[k].B) return s[k].A > s[k].B ? 'A' : 'B';
  }
  return null;
}

/**
 * BUILD 3.66 · replay a match's events (point events and a 'buzzer' note):
 * after the buzzer, points count only until someone leads; that side has won.
 */
export function tennisReplayEvents(
  events: ReadonlyArray<{ event_type: string; payload?: unknown }>,
  options: number | TennisOpts = TENNIS_SETS_TO_WIN,
): { score: TennisScore; buzzer: boolean } {
  let s = emptyTennis();
  let buzzer = false;
  for (const e of events) {
    const p = (e.payload ?? {}) as { team_side?: unknown; kind?: unknown };
    if (e.event_type === 'note' && p.kind === 'buzzer') { buzzer = true; continue; }
    if (e.event_type !== 'score') continue;
    if (buzzer && tennisLeader(s)) break; // decided at the buzzer
    s = tennisPoint(s, p.team_side === 'B' ? 'B' : 'A', options);
  }
  if (buzzer && !s.winner) { const l = tennisLeader(s); if (l) s = { ...s, winner: l }; }
  return { score: s, buzzer };
}

/** Games completed so far in the whole match (for the serve rotation). */
export function tennisGamesPlayed(s: TennisScore): number {
  return s.sets.reduce((n, x) => n + x.A + x.B, 0) + s.games.A + s.games.B;
}

const CALL = ['0', '15', '30', '40'];

/** How the current game reads: 15-30, deuce, advantage — or tiebreak numbers. */
export function tennisPointsDisplay(s: TennisScore, scoring: TennisGameScoring = 'ad'): { a: string; b: string; status?: string } {
  const { A: a, B: b } = s.points;
  if (s.tiebreak) return { a: String(a), b: String(b), status: s.matchTiebreak ? 'Match tiebreak' : 'Tiebreak' };
  if (a >= 3 && b >= 3) {
    // BUILD 3.63: the point that decides a no-ad game (or a semi-ad one's second deuce).
    if (a === b && (scoring === 'noad' || (scoring === 'semiad' && a >= 4))) return { a: '40', b: '40', status: 'Deciding point' };
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
