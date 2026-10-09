/**
 * Stage 10 · TT3 (Oct 2026) · a match scored on paper, typed in afterwards —
 * ONE rule for the app and the server.
 *
 * This file is byte-identical in both repos:
 *   app     src/scoring/typedScore.ts
 *   server  src/utils/typedScore.ts
 * Edit both, or neither.
 *
 * The typed games (or sets) become the points the pad would have sent, in a
 * natural order, and those points are replayed by the sport's own rules — so a
 * typed score is accepted only when it is a real, finished result under the
 * match's rules (11-9 yes; 11-10 only with a golden point; no game after the
 * match was won; tennis sets with their tiebreaks). The server then records
 * the points (marked typed) and works the match out as if it had been scored
 * live: score line, stats, boards, the tournament's table and bracket.
 *
 * Sports: every one scored in games or sets — badminton, table tennis,
 * pickleball (rally or side-out), volleyball, tennis — and their team ties.
 */
import { gamesWinner, standardRules, tennisOptsOf, type MatchRules } from './matchRules';
import { emptyTennis, tennisPoint, type TennisScore } from './tennisCore';
import { sideOutRally, sideOutStart, type SideOutOpts } from './pickleballCore';
import { boardPointsFor, boardWhite, tieOutcome, type RubberResult, type TieSpec } from './tieCore';

export type TypedSide = 'A' | 'B';
/** One game (rally sports) or set (tennis): each side's score; a tennis set won 7-6 also gives its tiebreak points. */
export type TypedSet = { a: number; b: number; tbA?: number | null; tbB?: number | null };
/** A point to record, as the pad sends it (side-out pickleball: a rally). */
export type TypedPoint = { side: TypedSide; kind?: 'rally' };

export const TYPED_SPORTS = ['badminton', 'tennis', 'tabletennis', 'pickleball', 'volleyball'] as const;
const sportKey = (s: string | null | undefined) => String(s ?? '').toLowerCase().replace(/[-_\s]/g, '');
export const typedScoreSport = (s: string | null | undefined): boolean => (TYPED_SPORTS as readonly string[]).includes(sportKey(s));

const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const other = (s: TypedSide): TypedSide => (s === 'A' ? 'B' : 'A');

/** Points (or games) for a w–l finish: the loser's, alternating, then the winner's — so it can't end early. */
function interleave(winner: TypedSide, w: number, l: number): TypedSide[] {
  const out: TypedSide[] = [];
  let x = 0; let y = 0;
  const loser = other(winner);
  while (y < l && x < w - 1) { out.push(loser); y++; out.push(winner); x++; }
  while (y < l) { out.push(loser); y++; }
  while (x < w) { out.push(winner); x++; }
  return out;
}

/** A rally game: is it won, and by whom (the server's and the pad's rule). */
function rallyWon(a: number, b: number, target: number, cap: number | null | undefined, winBy2: boolean): TypedSide | null {
  if (cap != null) { if (a >= cap) return 'A'; if (b >= cap) return 'B'; }
  if (a >= target && (!winBy2 || a - b >= 2)) return 'A';
  if (b >= target && (!winBy2 || b - a >= 2)) return 'B';
  return null;
}

const label = (s: TypedSet) => `${s.a}-${s.b}`;

/** Rally sports (rally scoring). */
function rallyPoints(rules: MatchRules, sets: TypedSet[], sideOut: boolean, u: 'game' | 'set' = 'game'): { problem: string | null; points: TypedPoint[]; winner: TypedSide | null } {
  const U = u === 'set' ? 'Set' : 'Game'; // volleyball plays sets
  const bestOf = rules.bestOf ?? 3;
  const winBy2 = rules.winBy2 ?? true;
  const points: TypedPoint[] = [];
  let wonA = 0; let wonB = 0;
  const so: SideOutOpts = { target: rules.target ?? 11, winBy2, maxGames: bestOf, doubles: rules.players === 2, ...(rules.allGames ? { allGames: true } : {}) };
  let soState = sideOut ? sideOutStart(so) : null;
  for (let g = 0; g < sets.length; g++) {
    const set = sets[g]!;
    if (gamesWinner(wonA, wonB, bestOf, rules.allGames)) return { problem: `The match was already won before ${u} ${g + 1}.`, points, winner: null };
    if (set.a === set.b) return { problem: `${U} ${g + 1} (${label(set)}) has no winner.`, points, winner: null };
    const deciding = g + 1 === bestOf;
    const target = deciding && rules.finalTarget ? rules.finalTarget : rules.target ?? 11;
    const winner: TypedSide = set.a > set.b ? 'A' : 'B';
    const order = interleave(winner, Math.max(set.a, set.b), Math.min(set.a, set.b));
    // Replay: the game ends exactly on its last point.
    let a = 0; let b = 0;
    for (let i = 0; i < order.length; i++) {
      if (order[i] === 'A') a++; else b++;
      const w = rallyWon(a, b, target, rules.cap, winBy2);
      if (w && i < order.length - 1) return { problem: `${U} ${g + 1}: ${label(set)} isn’t a score a ${u} can finish on (it ends at ${a}-${b}).`, points, winner: null };
      if (!w && i === order.length - 1) return { problem: `${U} ${g + 1}: ${label(set)} isn’t finished — ${winBy2 ? `to ${target}, win by 2${rules.cap ? ` (up to ${rules.cap})` : ''}` : `to ${target}`}.`, points, winner: null };
    }
    if (soState) {
      // Side-out: a point scores only for the server — a rally first wins the serve back.
      for (const want of order) {
        const before = soState.cur[want];
        let guard = 0;
        while (soState.cur[want] === before && guard++ < 6) {
          points.push({ side: want, kind: 'rally' });
          soState = sideOutRally(soState, want, so);
          if (soState.games.length > g) break; // the game ended on this rally
        }
      }
    } else {
      for (const s of order) points.push({ side: s });
    }
    if (winner === 'A') wonA++; else wonB++;
  }
  const decided = gamesWinner(wonA, wonB, bestOf, rules.allGames);
  if (!decided) return { problem: rules.allGames ? `Every ${u} is played: ${bestOf} ${u}s.` : `The match isn’t finished: the first to ${Math.ceil(bestOf / 2)} ${u}s wins.`, points, winner: null };
  return { problem: null, points, winner: decided };
}

/** Tennis: sets of games (each game a love game), a set's tiebreak, a match tiebreak. */
function tennisPoints(rules: MatchRules, sets: TypedSet[]): { problem: string | null; points: TypedPoint[]; winner: TypedSide | null } {
  const opts = tennisOptsOf(rules);
  let s: TennisScore = emptyTennis();
  const points: TypedPoint[] = [];
  const play = (side: TypedSide) => { points.push({ side }); s = tennisPoint(s, side, opts); };
  for (let k = 0; k < sets.length; k++) {
    const set = sets[k]!;
    if (s.winner) return { problem: `The match was already won before set ${k + 1}.`, points, winner: null };
    if (set.a === set.b) return { problem: `Set ${k + 1} (${label(set)}) has no winner.`, points, winner: null };
    const winner: TypedSide = set.a > set.b ? 'A' : 'B';
    const w = Math.max(set.a, set.b); const l = Math.min(set.a, set.b);
    const before = s.sets.length;
    const typedTb = set.tbA != null && set.tbB != null;
    if (s.matchTiebreak) {
      // The match tiebreak: its points, typed as the set (10-7); it's kept as a 1-0 set with those points.
      for (const p of interleave(winner, w, l)) { if (s.sets.length > before) break; play(p); }
      const done = s.sets[before];
      if (!done || !done.tiebreak || done.tiebreak.A !== set.a || done.tiebreak.B !== set.b) return { problem: `Set ${k + 1} is the match tiebreak: ${label(set)} isn’t a finished one (to 10, win by 2).`, points, winner: null };
      continue;
    }
    for (const g of interleave(winner, w, l)) {
      if (s.sets.length > before) break;
      if (s.tiebreak) {
        // A set's tiebreak: the typed points (7-5), or the winner's points until it's won.
        if (typedTb) {
          const tw = winner === 'A' ? set.tbA! : set.tbB!; const tl = winner === 'A' ? set.tbB! : set.tbA!;
          if (tw <= tl) return { problem: `Set ${k + 1}: the tiebreak ${set.tbA}-${set.tbB} goes the other way.`, points, winner: null };
          for (const p of interleave(winner, tw, tl)) { if (s.sets.length > before) break; play(p); }
        } else {
          for (let guard = 0; guard < 40 && s.sets.length === before; guard++) play(winner);
        }
        break;
      }
      for (let p = 0; p < 4; p++) play(g);
    }
    const done = s.sets[before];
    if (!done || done.A !== set.a || done.B !== set.b) {
      return { problem: `Set ${k + 1}: ${label(set)} isn’t a finished set under this match’s rules${done ? ` (it ends ${done.A}-${done.B})` : ''}.`, points, winner: null };
    }
    if (typedTb && (!done.tiebreak || done.tiebreak.A !== set.tbA || done.tiebreak.B !== set.tbB)) {
      return { problem: `Set ${k + 1}: ${done.tiebreak ? `the tiebreak ${set.tbA}-${set.tbB} isn’t a finished one (win by 2)` : 'this set has no tiebreak'}.`, points, winner: null };
    }
  }
  if (!s.winner) return { problem: `The match isn’t finished: ${opts.setsToWin} sets to win.`, points, winner: null };
  return { problem: null, points, winner: s.winner };
}

/** One match's typed score → its points, or why it can't be. */
export function typedMatchPoints(sport: string | null | undefined, rules: Partial<MatchRules> | null | undefined, sets: unknown): { problem: string | null; points: TypedPoint[]; winner: TypedSide | null } {
  const key = sportKey(sport);
  if (!typedScoreSport(sport)) return { problem: 'Typed scores are for the sports scored in games or sets.', points: [], winner: null };
  if (!Array.isArray(sets) || sets.length === 0) return { problem: 'Type each game’s (or set’s) score.', points: [], winner: null };
  for (const x of sets as TypedSet[]) {
    if (!x || !whole(x.a) || !whole(x.b) || (x.tbA != null && !whole(x.tbA)) || (x.tbB != null && !whole(x.tbB))) return { problem: 'Each score is a whole number.', points: [], winner: null };
  }
  const r = { ...(standardRules(sport) as MatchRules), ...(rules ?? {}) } as MatchRules;
  if (key === 'tennis') return tennisPoints(r, sets as TypedSet[]);
  return rallyPoints(r, sets as TypedSet[], key === 'pickleball' && r.scoring === 'sideout', key === 'volleyball' ? 'set' : 'game');
}

/**
 * A team tie typed match by match (each a list of games / sets): every
 * match's points in order, until the tie is decided.
 */
export function typedTiePoints(
  sport: string | null | undefined, rules: Partial<MatchRules> | null | undefined, spec: TieSpec, rubbers: unknown,
): { problem: string | null; points: TypedPoint[]; winner: TypedSide | 'draw' | null } {
  if (!Array.isArray(rubbers) || rubbers.length === 0) return { problem: 'Type each match’s score.', points: [], winner: null };
  const points: TypedPoint[] = [];
  const results: RubberResult[] = [];
  const unitsOfSets = (sets: TypedSet[], side: TypedSide) => sets.reduce((n, x) => n + (side === 'A' ? x.a : x.b), 0);
  for (let i = 0; i < rubbers.length; i++) {
    const rubber = spec.rubbers[i];
    if (!rubber) return { problem: `This tie has ${spec.rubbers.length} matches.`, points, winner: null };
    if (tieOutcome(spec, results).finished) return { problem: `The tie was decided before ${rubber.label}.`, points, winner: null };
    const own = { ...(rules ?? {}), ...((rubber.rules ?? {}) as Partial<MatchRules>), tie: null, rubbers: null, players: rubber.players === 2 ? 2 : null } as Partial<MatchRules>; // Stage 11 · PB3: a match's own rules
    const m = typedMatchPoints(sport, own, rubbers[i]);
    if (m.problem) return { problem: `${rubber.label}: ${m.problem}`, points, winner: null };
    points.push(...m.points);
    const sets = rubbers[i] as TypedSet[];
    results.push({ key: rubber.key, winner: m.winner!, sets: { A: sets.map((x) => x.a), B: sets.map((x) => x.b) }, units: { A: unitsOfSets(sets, 'A'), B: unitsOfSets(sets, 'B') } });
  }
  const o = tieOutcome(spec, results);
  if (!o.finished) return { problem: 'The tie isn’t decided yet — type the rest of its matches.', points, winner: null };
  return { problem: null, points, winner: o.decided };
}

/** "11-8, 9-11, 11-6" — the typed games for the timeline (a set's tiebreak in brackets). */
export function typedScoreText(sets: TypedSet[]): string {
  return sets.map((x) => `${x.a}-${x.b}${x.tbA != null && x.tbB != null ? ` (${Math.min(x.tbA, x.tbB)})` : ''}`).join(', ');
}

/**
 * Stage 12 · CH5 · a team chess match typed from its match sheet: each board's
 * result in board order — 'A' or 'B' (that team won the board) or 'draw'. Each
 * becomes the result the pad would have recorded (White / Black by the board's
 * colours), and the match is worked out by game points. Every board is played.
 */
export const typedChessTie = (sport: string | null | undefined, spec: TieSpec | null): boolean => sportKey(sport) === 'chess' && !!spec;
export function typedChessBoards(spec: TieSpec, boards: unknown): { problem: string | null; results: Array<'white' | 'black' | 'draw'>; winner: TypedSide | 'draw' | null; units?: { A: number; B: number } } {
  // Stage 12 · CH7: a mini-match's play-off games are only played when needed — the games up to the decision.
  const hasDeciders = spec.rubbers.some((r) => r.decider);
  const given = Array.isArray(boards) ? (hasDeciders ? boards.slice(0, (boards as unknown[]).reduce((n: number, b, i) => (b ? i + 1 : n), 0)) : boards) : null;
  const regular = spec.rubbers.filter((r) => !r.decider).length;
  if (!given || (hasDeciders ? given.length < regular || given.length > spec.rubbers.length : given.length !== spec.rubbers.length)) {
    return { problem: hasDeciders ? `Give every game’s result (${regular}), and the play-offs that were played.` : `Give every board’s result (${spec.rubbers.length}).`, results: [], winner: null };
  }
  const results: Array<'white' | 'black' | 'draw'> = [];
  const rr: RubberResult[] = [];
  for (let i = 0; i < given.length; i++) {
    const b = given[i];
    if (b !== 'A' && b !== 'B' && b !== 'draw') return { problem: `${spec.rubbers[i]!.label}: who won it, or a draw.`, results: [], winner: null };
    // Nothing after the match is decided.
    if (i > 0 && tieOutcome(spec, rr).finished) return { problem: `${spec.rubbers[i]!.label} wasn’t needed: the match was already decided.`, results: [], winner: null };
    const white = boardWhite(spec, i);
    const w: 'white' | 'black' | 'draw' = b === 'draw' ? 'draw' : b === white ? 'white' : 'black';
    results.push(w);
    const pts = boardPointsFor(spec, w);
    const a = white === 'A' ? pts.white : pts.black; const bb = white === 'A' ? pts.black : pts.white;
    rr.push({ key: spec.rubbers[i]!.key, winner: b, sets: { A: [a], B: [bb] }, units: { A: a, B: bb } });
  }
  const o = tieOutcome(spec, rr);
  if (hasDeciders && !o.finished) return { problem: 'Still level: give the next play-off game.', results: [], winner: null };
  return { problem: null, results, winner: o.decided, units: { A: rr.reduce((t, r) => t + r.units.A, 0), B: rr.reduce((t, r) => t + r.units.B, 0) } };
}
