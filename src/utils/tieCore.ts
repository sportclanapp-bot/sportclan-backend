/**
 * Stage 9 · T3 (Oct 2026) · a team tie — ONE engine for the app and the server.
 *
 * This file is byte-identical in both repos:
 *   app     src/scoring/tieCore.ts
 *   server  src/utils/tieCore.ts
 * Edit both, or neither.
 *
 * A tie is the organiser's own list of matches ("rubbers") between two teams —
 * Davis Cup's singles and doubles, a club league's three doubles (one "90+"
 * pair), seven doubles in Gold / Silver / Bronze tiers, TPL's men's, women's,
 * men's doubles and mixed — and how it's won:
 *   - 'first': first to N rubbers (default: a majority); the tie ends as soon as
 *     one side has them (no dead rubbers);
 *   - 'all':   every rubber is played; most rubbers wins (level: most games or
 *     points, then a draw);
 *   - 'games': every rubber is played; most games (tennis) or points (the rally
 *     sports) in total wins (level: most rubbers, then a draw).
 * Each rubber is scored by the sport's own engine with the match's rules; this
 * file splits the match's events into rubbers with that engine (`rubberOf`), so
 * any sport with a per-match engine can be a tie: tennis, badminton, table
 * tennis, pickleball.
 */

export type TieSide = 'A' | 'B';
/** One match of the tie: its key ("R1", or BWF's "S1"), what it's called, singles or doubles, and an optional combined age for a pair. */
export type TieRubber = { key: string; label: string; players: 1 | 2; pairAgeMin?: number | null };
export type TieWin = 'first' | 'all' | 'games';
export type TieSpec = {
  rubbers: TieRubber[];
  win: TieWin;
  /** 'first' only: rubbers needed (default: a majority). */
  firstTo?: number | null;
  /** A player may play more than one rubber of a kind (Davis Cup's reverse singles). Default: one singles and one doubles at most. */
  repeatPlayers?: boolean;
};

export const TIE_SPORTS = ['badminton', 'tennis', 'tabletennis', 'pickleball'] as const;
export const TIE_LABEL_MAX = 30;

const isWhole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/** Why a tie can't be (in the organiser's words), or null. No top on the number of rubbers. */
export function tieSpecProblem(spec: unknown): string | null {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'A tie is a list of matches and how it’s won.';
  const s = spec as Record<string, unknown>;
  if (!Array.isArray(s.rubbers) || s.rubbers.length === 0) return 'A tie needs at least one match.';
  const keys = new Set<string>();
  for (const r of s.rubbers as unknown[]) {
    if (!r || typeof r !== 'object') return 'Each match of a tie has a name and its players.';
    const x = r as Record<string, unknown>;
    if (typeof x.key !== 'string' || !/^[A-Za-z0-9]{1,8}$/.test(x.key)) return 'Each match of a tie needs a short code.';
    if (keys.has(x.key)) return `Two matches share “${x.key}”.`;
    keys.add(x.key);
    if (typeof x.label !== 'string' || !x.label.trim() || x.label.trim().length > TIE_LABEL_MAX) return `A match’s name is 1 to ${TIE_LABEL_MAX} characters.`;
    if (x.players !== 1 && x.players !== 2) return `${x.label.trim()} is singles or doubles.`;
    if (x.pairAgeMin != null && (!isWhole(x.pairAgeMin) || x.pairAgeMin < 40 || x.pairAgeMin > 200 || x.players !== 2)) return `${x.label.trim()}: a pair’s combined age is 40 to 200, for doubles.`;
  }
  if (s.win !== 'first' && s.win !== 'all' && s.win !== 'games') return 'A tie is won by the first to a number of matches, by most matches, or by most games.';
  const n = (s.rubbers as unknown[]).length;
  if (s.firstTo != null && (s.win !== 'first' || !isWhole(s.firstTo) || s.firstTo < 1 || s.firstTo > n)) return `First to 1 to ${n} matches.`;
  if (s.repeatPlayers != null && typeof s.repeatPlayers !== 'boolean') return 'Playing more than one match is on or off.';
  return null;
}

/** Rubbers a side needs in a 'first' tie. */
export function tieNeed(spec: TieSpec): number {
  return spec.firstTo ?? Math.floor(spec.rubbers.length / 2) + 1;
}

/** A finished rubber: who won it, its sets (games / points per set), and the units it adds (tennis: games; rally: points). */
export type RubberResult = { key: string; winner: TieSide; sets: { A: number[]; B: number[] }; units: { A: number; B: number } };
export type TieOutcome = { rubbersA: number; rubbersB: number; unitsA: number; unitsB: number; decided: TieSide | 'draw' | null; finished: boolean };

/** Where the tie stands after these finished rubbers. */
export function tieOutcome(spec: TieSpec, results: ReadonlyArray<RubberResult>): TieOutcome {
  let rubbersA = 0, rubbersB = 0, unitsA = 0, unitsB = 0;
  for (const r of results) {
    if (r.winner === 'A') rubbersA += 1; else rubbersB += 1;
    unitsA += r.units.A; unitsB += r.units.B;
  }
  const all = results.length >= spec.rubbers.length;
  const by = (a: number, b: number): TieSide | null => (a > b ? 'A' : b > a ? 'B' : null);
  let decided: TieSide | 'draw' | null = null;
  if (spec.win === 'first') {
    const need = tieNeed(spec);
    decided = rubbersA >= need ? 'A' : rubbersB >= need ? 'B' : null;
    if (!decided && all) decided = by(rubbersA, rubbersB) ?? by(unitsA, unitsB) ?? 'draw';
  } else if (all) {
    decided = spec.win === 'all'
      ? by(rubbersA, rubbersB) ?? by(unitsA, unitsB) ?? 'draw'
      : by(unitsA, unitsB) ?? by(rubbersA, rubbersB) ?? 'draw';
  }
  return { rubbersA, rubbersB, unitsA, unitsB, decided, finished: decided !== null };
}

/** One rubber's events read by the sport's engine: its winner (if decided), sets and units. */
export type RubberRead = { winner: TieSide | null; sets: { A: number[]; B: number[] }; units: { A: number; B: number } };

/**
 * Split a match's events into the tie's rubbers. Every event belongs to the
 * rubber in play; a rubber closes when the engine says it's won, and the next
 * starts fresh. Nothing after the tie is decided counts.
 */
export function splitTie<E extends { event_type: string }>(
  events: ReadonlyArray<E>, spec: TieSpec, rubberOf: (events: E[], rubber: TieRubber) => RubberRead,
): { results: RubberResult[]; current: number; currentEvents: E[]; outcome: TieOutcome } {
  const results: RubberResult[] = [];
  let cur: E[] = [];
  let outcome = tieOutcome(spec, results);
  for (const e of events) {
    if (outcome.finished || results.length >= spec.rubbers.length) break;
    cur.push(e);
    if (e.event_type !== 'score') continue;
    const rubber = spec.rubbers[results.length]!;
    const r = rubberOf(cur, rubber);
    if (!r.winner) continue;
    results.push({ key: rubber.key, winner: r.winner, sets: r.sets, units: r.units });
    cur = [];
    outcome = tieOutcome(spec, results);
  }
  return { results, current: results.length, currentEvents: cur, outcome };
}

/** The sum of a side's sets (tennis: games; the rally sports: points). */
export const unitsOf = (sets: ReadonlyArray<number>): number => sets.reduce((n, x) => n + (Number(x) || 0), 0);
