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
/**
 * One match of the tie: its key ("R1", or BWF's "S1"), what it's called,
 * singles or doubles, and an optional combined age for a pair.
 *
 * Stage 10 · TT1: `a` / `b` — positions instead of a free choice: the first
 * side's players A, B, C… (1, 2, 3…) and the second side's X, Y, Z… Each
 * captain names their positions once and every match follows (A v X, B v Y,
 * A v Y…). A match without positions is the captain's free choice.
 */
export type TieRubber = {
  key: string; label: string; players: 1 | 2; pairAgeMin?: number | null; a?: number[] | null; b?: number[] | null;
  /**
   * Stage 11 · PB3 · league ties (MLP, WPBL, IPBL, PBL):
   *  - `value`: what winning this match is worth to the tie (IPBL's Grand Rally 2; default 1);
   *  - `decider`: played only when the tie is level after the other matches — MLP's
   *    DreamBreaker at 2-2, WPBL's mixed decider; its winner wins the tie;
   *  - `rules`: this match's own rules over the tie's (the DreamBreaker: singles,
   *    rally scoring to 21, one game) — checked by the sport's rules;
   *  - `rotateEvery`: the pad says "rotate players" every N points (DreamBreaker 4, Grand Rally 3).
   */
  value?: number | null; decider?: boolean; rules?: Record<string, unknown> | null; rotateEvery?: number | null;
};
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
    // Stage 10 · TT1: positions — both sides or neither, one a player, different within the match.
    const hasA = x.a != null; const hasB = x.b != null;
    if (hasA !== hasB) return `${x.label.trim()}: give positions for both sides, or neither.`;
    if (hasA) {
      for (const pos of [x.a, x.b]) {
        if (!Array.isArray(pos) || pos.length !== x.players || pos.some((n) => !isWhole(n) || n < 1) || new Set(pos).size !== pos.length) return `${x.label.trim()}: ${x.players === 1 ? 'one position' : 'two different positions'} a side.`;
      }
    }
    // Stage 11 · PB3: worth, decider, own rules, rotation — the organiser's numbers, no top.
    if (x.value != null && (!isWhole(x.value) || x.value < 1)) return `${x.label.trim()}: a match is worth 1 or more.`;
    if (x.decider != null && typeof x.decider !== 'boolean') return `${x.label.trim()}: a deciding match is on or off.`;
    if (x.rotateEvery != null && (!isWhole(x.rotateEvery) || x.rotateEvery < 1)) return `${x.label.trim()}: rotate every 1 or more points.`;
    if (x.rules != null && (typeof x.rules !== 'object' || Array.isArray(x.rules) || 'tie' in x.rules || 'rubbers' in x.rules)) return `${x.label.trim()}: its own rules are a match’s rules.`;
  }
  // Stage 11 · PB3: deciding matches come last, after at least one other.
  const rs = s.rubbers as Array<{ decider?: boolean }>;
  const firstDecider = rs.findIndex((r) => r.decider === true);
  if (firstDecider === 0) return 'A tie needs a match before its deciding match.';
  if (firstDecider > 0 && rs.slice(firstDecider).some((r) => r.decider !== true)) return 'Deciding matches come last.';
  if (s.win !== 'first' && s.win !== 'all' && s.win !== 'games') return 'A tie is won by the first to a number of matches, by most matches, or by most games.';
  const n = regularValue(s.rubbers as TieRubber[]); // Stage 11 · PB3: in what the matches are worth
  if (s.firstTo != null && (s.win !== 'first' || !isWhole(s.firstTo) || s.firstTo < 1 || s.firstTo > n)) return `First to 1 to ${n}${(s.rubbers as TieRubber[]).some((r) => (r.value ?? 1) !== 1) ? ' points' : ' matches'}.`;
  if (s.repeatPlayers != null && typeof s.repeatPlayers !== 'boolean') return 'Playing more than one match is on or off.';
  return null;
}

/** Stage 10 · TT1 · a position's letter: the first side A, B, C…; the second X, Y, Z, then U, V, W… (then numbered). */
export function positionLetter(side: TieSide, n: number): string {
  if (side === 'A') return n >= 1 && n <= 26 ? String.fromCharCode(64 + n) : `A${n}`;
  const away = 'XYZUVWRST';
  return n >= 1 && n <= away.length ? away[n - 1]! : `X${n}`;
}

/** The positions a side names (1…n), in order; empty when the tie has none. */
export function positionsOf(spec: TieSpec, side: TieSide): number[] {
  const set = new Set<number>();
  for (const r of spec.rubbers) for (const n of (side === 'A' ? r.a : r.b) ?? []) set.add(n);
  return [...set].sort((p, q) => p - q);
}

/** "A v X", "B & C v Y & Z" — a match's positions, or null for a free choice. */
export function positionsLabel(r: TieRubber): string | null {
  if (!r.a || !r.b) return null;
  return `${r.a.map((n) => positionLetter('A', n)).join(' & ')} v ${r.b.map((n) => positionLetter('B', n)).join(' & ')}`;
}

/**
 * Fill a side's matches from its positions (`positions[n]` = the player at n)
 * and its free choices (`free[key]`). Missing players are left out, so the
 * line-up check says what's missing.
 */
export function expandPositions(spec: TieSpec, side: TieSide, positions: Record<string, string>, free: Record<string, string[]> = {}): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of spec.rubbers) {
    const pos = side === 'A' ? r.a : r.b;
    out[r.key] = pos ? pos.map((n) => positions[String(n)]).filter((u): u is string => !!u) : (free[r.key] ?? []);
  }
  return out;
}

/** Why a side's line-up breaks its positions (the same position, the same player; different positions, different players), or null. */
export function positionsProblem(spec: TieSpec, side: TieSide, lineup: Record<string, string[]>): string | null {
  const who = new Map<number, string>();
  for (const r of spec.rubbers) {
    const pos = side === 'A' ? r.a : r.b;
    if (!pos) continue;
    const ids = lineup[r.key] ?? [];
    for (let i = 0; i < pos.length; i++) {
      const u = ids[i];
      if (!u) continue;
      const had = who.get(pos[i]!);
      if (had && had !== u) return `${positionLetter(side, pos[i]!)} is one player in every match.`;
      who.set(pos[i]!, u);
    }
  }
  const seen = new Map<string, number>();
  for (const [n, u] of who) {
    const other = seen.get(u);
    if (other != null) return `${positionLetter(side, other)} and ${positionLetter(side, n)} are two different players.`;
    seen.set(u, n);
  }
  return null;
}

/**
 * Stage 10 · TT1b · who names A, B, C: as in ITTF team events, a toss (the
 * winner chooses) or the organiser's pick, recorded before the line-ups.
 * Stored on matches.tie_toss; none = the fixture's first-named side (as before).
 * `abc` is the fixture side ('A' first-named, 'B' second) that names A, B, C.
 */
export type TieToss = { abc: TieSide; how: 'toss' | 'pick'; winner?: TieSide | null; at?: string | null };

/** A stored toss, or null when there's none (or it isn't one). */
export function tieTossOf(x: unknown): TieToss | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const t = x as Record<string, unknown>;
  if (t.abc !== 'A' && t.abc !== 'B') return null;
  if (t.how !== 'toss' && t.how !== 'pick') return null;
  const winner = t.winner === 'A' || t.winner === 'B' ? t.winner : null;
  if (t.how === 'toss' && !winner) return null;
  return { abc: t.abc, how: t.how, ...(t.how === 'toss' ? { winner } : {}), at: typeof t.at === 'string' ? t.at : null };
}

/** What's wrong with a toss sent to be recorded, or null. */
export function tieTossProblem(x: unknown): string | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return 'Say who names A, B, C.';
  const t = x as Record<string, unknown>;
  if (t.how !== 'toss' && t.how !== 'pick') return 'A toss, or the organiser’s pick.';
  if (t.abc !== 'A' && t.abc !== 'B') return 'Say which side names A, B, C.';
  if (t.how === 'toss' && t.winner !== 'A' && t.winner !== 'B') return 'Say who won the toss.';
  return null;
}

/** The fixture side that names A, B, C (the first-named one without a toss). */
export const abcSideOf = (toss: TieToss | null | undefined): TieSide => toss?.abc ?? 'A';

/** The letters a fixture side names: 'A' (A, B, C…) or 'B' (X, Y, Z…). */
export const letterSideOf = (fixtureSide: TieSide, toss: TieToss | null | undefined): TieSide => (fixtureSide === abcSideOf(toss) ? 'A' : 'B');

/** "A, B, C" / "X, Y, Z" — the letters of one set of positions. */
export const lettersOf = (spec: TieSpec, letters: TieSide): string => positionsOf(spec, letters).map((n) => positionLetter(letters, n)).join(', ');

/**
 * "S10 PYC won the toss and chose A, B · S10 Deccan is X, Y" — or the pick,
 * or (no toss) the first-named side.
 */
export function tieTossText(spec: TieSpec, toss: TieToss | null | undefined, names: Record<TieSide, string>): string {
  const abc = abcSideOf(toss);
  const xyz: TieSide = abc === 'A' ? 'B' : 'A';
  const abcL = lettersOf(spec, 'A'); const xyzL = lettersOf(spec, 'B');
  if (toss?.how === 'toss' && toss.winner) {
    const w = toss.winner; const other: TieSide = w === 'A' ? 'B' : 'A';
    const chose = w === abc ? abcL : xyzL;
    return `${names[w]} won the toss and chose ${chose} · ${names[other]} is ${w === abc ? xyzL : abcL}`;
  }
  if (toss?.how === 'pick') return `${names[abc]} is ${abcL} · ${names[xyz]} is ${xyzL}`;
  return `No toss recorded, so ${names.A} (named first) is ${abcL} · ${names.B} is ${xyzL}`;
}

/** Stage 11 · PB3: what the matches before any deciding match are worth together. */
export function regularValue(rubbers: ReadonlyArray<TieRubber>): number {
  return rubbers.filter((r) => !r.decider).reduce((n, r) => n + (r.value ?? 1), 0);
}
/** Stage 11 · PB3: whether any match is worth more than 1 (the tie's score is then points, not matches). */
export const tieWeighted = (spec: TieSpec): boolean => spec.rubbers.some((r) => (r.value ?? 1) !== 1);

/** Rubbers a side needs in a 'first' tie (Stage 11 · PB3: in what they're worth; deciding matches don't count). */
export function tieNeed(spec: TieSpec): number {
  return spec.firstTo ?? Math.floor(regularValue(spec.rubbers) / 2) + 1;
}

/**
 * A finished rubber: who won it (Stage 11 · PB9: or 'draw' — a timed match left
 * level), its sets (games / points per set), and the units it adds (tennis:
 * games; rally: points).
 */
export type RubberResult = { key: string; winner: TieSide | 'draw'; sets: { A: number[]; B: number[] }; units: { A: number; B: number } };
/** Stage 11 · PB3: `decider` — the tie went to its deciding match (the 3/2/1/0 table points read it). */
export type TieOutcome = { rubbersA: number; rubbersB: number; unitsA: number; unitsB: number; decided: TieSide | 'draw' | null; finished: boolean; decider?: boolean };

/**
 * Where the tie stands after these finished rubbers. Rubbers count what they're
 * worth (Stage 11 · PB3). Deciding matches are played only when the matches
 * before them leave the tie level on its win rule (rubbers; games for a tie on
 * games) — then the first deciding match won decides it; without one, level is
 * settled as before (most games / matches, else a draw).
 */
export function tieOutcome(spec: TieSpec, results: ReadonlyArray<RubberResult>): TieOutcome {
  let rubbersA = 0, rubbersB = 0, unitsA = 0, unitsB = 0;
  const regular = spec.rubbers.filter((r) => !r.decider).length;
  const hasDecider = regular < spec.rubbers.length;
  results.forEach((r, i) => {
    const worth = spec.rubbers[i]?.value ?? 1;
    if (i < regular) { if (r.winner === 'A') rubbersA += worth; else if (r.winner === 'B') rubbersB += worth; }
    unitsA += r.units.A; unitsB += r.units.B;
  });
  const allRegular = results.length >= regular;
  const by = (a: number, b: number): TieSide | null => (a > b ? 'A' : b > a ? 'B' : null);
  let decided: TieSide | 'draw' | null = null;
  let level = false; // the regular matches are played and leave the tie level
  if (spec.win === 'first') {
    const need = tieNeed(spec);
    decided = rubbersA >= need ? 'A' : rubbersB >= need ? 'B' : null;
    if (!decided && allRegular) { decided = by(rubbersA, rubbersB); level = !decided; }
  } else if (allRegular) {
    decided = spec.win === 'all' ? by(rubbersA, rubbersB) : by(unitsA, unitsB);
    level = !decided;
  }
  let decider = false;
  if (level) {
    if (hasDecider) {
      // The deciding matches, in order: the first one won decides the tie.
      const won = results.slice(regular).find((r) => r.winner === 'A' || r.winner === 'B');
      if (won) { decided = won.winner; decider = true; if (won.winner === 'A') rubbersA += spec.rubbers[results.indexOf(won)]?.value ?? 1; else rubbersB += spec.rubbers[results.indexOf(won)]?.value ?? 1; }
      else if (results.length >= spec.rubbers.length) decided = (spec.win === 'games' ? by(rubbersA, rubbersB) : by(unitsA, unitsB)) ?? 'draw';
    } else {
      decided = (spec.win === 'games' ? by(rubbersA, rubbersB) : by(unitsA, unitsB)) ?? 'draw';
    }
  }
  return { rubbersA, rubbersB, unitsA, unitsB, decided, finished: decided !== null, ...(decider ? { decider: true } : {}) };
}

/** One rubber's events read by the sport's engine: its winner (if decided; Stage 11 · PB9: 'draw' when it ended level), sets and units. */
export type RubberRead = { winner: TieSide | 'draw' | null; sets: { A: number[]; B: number[] }; units: { A: number; B: number } };

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
    if (e.event_type !== 'score' && e.event_type !== 'note') continue; // Stage 11 · PB6 / PB9: a forfeited game or time called can end a match too
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
