/**
 * BUILD 3.58 · pickleball SIDE-OUT scoring — ONE rule for the app and the server.
 *
 * This file is byte-identical in both repos:
 *   app     src/scoring/pickleballCore.ts
 *   server  src/utils/pickleballCore.ts
 * Edit both, or neither.
 *
 * Only the serving side scores. A rally the receivers win is a fault on the
 * server: in singles the serve passes straight over (a side out); in doubles
 * the partner serves next (server 2), and only after both have served does it
 * pass over. A doubles game opens with one server only — the call is "0-0-2".
 * The side that served first in one game receives first in the next.
 * The scorer's "swap server" corrects who is serving (a mis-tap, a missed
 * fault); it changes the serving side and leaves the server number.
 *
 * The events are the rallies (`score` with kind 'rally', team_side = the side
 * that WON the rally) and swaps (`serve_swap`), in order. Nothing after the
 * deciding game counts.
 */

export type PbSide = 'A' | 'B';

export interface SideOutOpts {
  target: number;
  winBy2: boolean;
  /** Games in the match (best of). */
  maxGames: number;
  doubles: boolean;
  /** Stage 10 · TT5: every game is played; the match goes to more games won. */
  allGames?: boolean;
}

export interface SideOutState {
  /** Points in the game in play. */
  cur: { A: number; B: number };
  /** Each finished game's score. */
  games: Array<{ A: number; B: number }>;
  won: { A: number; B: number };
  /** 1-based game in play (stays on the deciding game once decided). */
  game: number;
  server: PbSide;
  /** Doubles: 1 or 2. Singles: always 1. */
  serverNum: 1 | 2;
  winner: PbSide | null;
}

const other = (s: PbSide): PbSide => (s === 'A' ? 'B' : 'A');

/** Who serves first in game n: A, then alternating game by game. */
function firstServer(game: number): PbSide {
  return game % 2 === 1 ? 'A' : 'B';
}

export function sideOutStart(opts: SideOutOpts): SideOutState {
  return {
    cur: { A: 0, B: 0 },
    games: [],
    won: { A: 0, B: 0 },
    game: 1,
    server: firstServer(1),
    serverNum: opts.doubles ? 2 : 1, // "0-0-2": the first side has one server
    winner: null,
  };
}

function gameWon(a: number, b: number, opts: SideOutOpts): PbSide | null {
  const lead = opts.winBy2 ? 2 : 1;
  if (a >= opts.target && a - b >= lead) return 'A';
  if (b >= opts.target && b - a >= lead) return 'B';
  return null;
}

/** One rally, won by `winner`. */
/** A point to `side` (the game, and the match, may end on it). */
function addPoint(s: SideOutState, side: PbSide, opts: SideOutOpts): SideOutState {
  const cur = { ...s.cur, [side]: s.cur[side] + 1 };
  const w = gameWon(cur.A, cur.B, opts);
  if (!w) return { ...s, cur };
  const games = [...s.games, cur];
  const won = { ...s.won, [w]: s.won[w] + 1 };
  const need = Math.floor(opts.maxGames / 2) + 1;
  if (opts.allGames ? won.A + won.B >= opts.maxGames : won[w] >= need) return { ...s, cur: { A: 0, B: 0 }, games, won, winner: won.A > won.B ? 'A' : 'B' };
  const game = s.game + 1;
  return { cur: { A: 0, B: 0 }, games, won, game, server: firstServer(game), serverNum: opts.doubles ? 2 : 1, winner: null };
}

export function sideOutRally(s: SideOutState, winner: PbSide, opts: SideOutOpts): SideOutState {
  if (s.winner) return s;
  if (winner === s.server) return addPoint(s, winner, opts);
  // A fault on the serving side.
  if (opts.doubles && s.serverNum === 1) return { ...s, serverNum: 2 };
  return { ...s, server: other(s.server), serverNum: 1 };
}

/**
 * Stage 9 · T9 · a penalty point (a technical foul): a point to `side` whoever
 * is serving; the serve doesn't change.
 */
export function sideOutPenalty(s: SideOutState, side: PbSide, opts: SideOutOpts): SideOutState {
  if (s.winner) return s;
  return addPoint(s, side, opts);
}

/** The scorer's correction: the other side is serving. */
export function sideOutSwap(s: SideOutState): SideOutState {
  if (s.winner) return s;
  return { ...s, server: other(s.server) };
}

/** Replay a match's events. */
export function sideOutReplay(
  events: ReadonlyArray<{ event_type: string; payload?: unknown }>,
  opts: SideOutOpts,
): SideOutState {
  let s = sideOutStart(opts);
  for (const e of events) {
    const p = (e.payload ?? {}) as { team_side?: unknown; kind?: unknown };
    if (e.event_type === 'serve_swap') s = sideOutSwap(s);
    else if (e.event_type === 'score' && p.kind === 'penalty') s = sideOutPenalty(s, p.team_side === 'B' ? 'B' : 'A', opts); // Stage 9 · T9
    else if (e.event_type === 'score') s = sideOutRally(s, p.team_side === 'B' ? 'B' : 'A', opts);
  }
  return s;
}

/** The umpire's call: server's score, receiver's score, and (doubles) the server number — "4-2-1". */
export function sideOutCall(s: SideOutState, doubles: boolean): string {
  const mine = s.cur[s.server];
  const theirs = s.cur[other(s.server)];
  return doubles ? `${mine}-${theirs}-${s.serverNum}` : `${mine}-${theirs}`;
}
