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
  /** Stage 11 · PB9: a timed match — level at time: the next point wins, or it ends level. */
  timedLevel?: 'next_point' | 'draw';
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
  /** Stage 11 · PB9: time has been called. */
  buzzer?: boolean;
  /** Stage 11 · PB9: the match ended level at time (no winner). */
  level?: boolean;
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
  if (s.winner || s.level) return s;
  if (winner === s.server) return afterTime(addPoint(s, winner, opts));
  // A fault on the serving side.
  if (opts.doubles && s.serverNum === 1) return { ...s, serverNum: 2 };
  return { ...s, server: other(s.server), serverNum: 1 };
}

/**
 * Stage 9 · T9 · a penalty point (a technical foul): a point to `side` whoever
 * is serving; the serve doesn't change.
 */
export function sideOutPenalty(s: SideOutState, side: PbSide, opts: SideOutOpts): SideOutState {
  if (s.winner || s.level) return s;
  return afterTime(addPoint(s, side, opts));
}

/** Stage 11 · PB9: who's ahead at the buzzer — on games won, then on points in the game in play. */
function leaderAtTime(s: SideOutState): PbSide | null {
  if (s.won.A !== s.won.B) return s.won.A > s.won.B ? 'A' : 'B';
  if (s.cur.A !== s.cur.B) return s.cur.A > s.cur.B ? 'A' : 'B';
  return null;
}
/** The match ends at time: the game in play is recorded, and counts for its leader when games were level. */
function endAtTime(s: SideOutState, winner: PbSide | null): SideOutState {
  const played = s.cur.A + s.cur.B > 0;
  const level = s.won.A === s.won.B;
  const games = played ? [...s.games, { ...s.cur }] : s.games;
  const won = played && level && winner ? { ...s.won, [winner]: s.won[winner] + 1 } : s.won;
  return { ...s, cur: played ? { A: 0, B: 0 } : s.cur, games, won, winner, buzzer: true, ...(winner ? {} : { level: true }) };
}
/** Stage 11 · PB9 · time called at the buzzer: the side ahead wins; level, the next point (or it ends level). */
export function sideOutCallTime(s: SideOutState, opts: SideOutOpts): SideOutState {
  if (s.winner || s.level || s.buzzer) return s;
  const lead = leaderAtTime(s);
  if (lead) return endAtTime(s, lead);
  if (opts.timedLevel === 'draw') return endAtTime(s, null);
  return { ...s, buzzer: true };
}
/** After a point once time is called (level then): the side now ahead wins. */
function afterTime(s: SideOutState): SideOutState {
  if (!s.buzzer || s.winner) return s;
  const lead = leaderAtTime(s);
  return lead ? endAtTime(s, lead) : s;
}

/**
 * Stage 11 · PB6 · a technical foul (USA Pickleball 22): a point off the
 * offender's score in the game; the serve doesn't change. (At 0 the app sends
 * a penalty point to the opponent instead.)
 */
export function sideOutPointOff(s: SideOutState, offender: PbSide): SideOutState {
  if (s.winner || s.cur[offender] <= 0) return s;
  return { ...s, cur: { ...s.cur, [offender]: s.cur[offender] - 1 } };
}

/** Stage 11 · PB6 · the game in play forfeited by `offender`: the opponent takes it, recorded at the target to 0 (11-0). */
export function sideOutForfeitGame(s: SideOutState, offender: PbSide, opts: SideOutOpts): SideOutState {
  if (s.winner || s.level) return s;
  const to = other(offender);
  return addPoint({ ...s, cur: { [to]: Math.max(opts.target, 0) - 1, [offender]: 0 } as { A: number; B: number } }, to, { ...opts, winBy2: false });
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
    else if (e.event_type === 'note' && p.kind === 'point_off') s = sideOutPointOff(s, p.team_side === 'B' ? 'B' : 'A'); // Stage 11 · PB6
    else if (e.event_type === 'note' && p.kind === 'game_forfeit') s = afterTime(sideOutForfeitGame(s, p.team_side === 'B' ? 'B' : 'A', opts));
    else if (e.event_type === 'note' && p.kind === 'buzzer') s = sideOutCallTime(s, opts); // Stage 11 · PB9
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
