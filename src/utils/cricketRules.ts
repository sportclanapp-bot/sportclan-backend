/**
 * Cricket match rules that depend on how the match was set up — ONE rule for
 * the app and the server (decision A6).
 *
 * This file is byte-identical in both repos:
 *   app     src/scoring/cricketRules.ts
 *   server  src/utils/cricketRules.ts
 * and both repos run the same fixture table against it (cricketRules test).
 * Edit both, or neither.
 *
 *   overs     every format takes an overs choice (it used to be Limited only,
 *             so Box and Pair were scored as 20 overs). A match without one —
 *             created before this — plays 20.
 *   all out   one wicket fewer than the players in that side's line-up (a
 *             last batter can't bat alone), at most 10. A side with no line-up
 *             (typed-in teams) is all out at 10, as before.
 */

export type CricketFormat = 'limited' | 'box' | 'pair';

export const DEFAULT_OVERS = 20;
export const DEFAULT_ALL_OUT = 10;

/** The overs each format offers on the create form, and its default. */
export const CRICKET_OVERS: Record<CricketFormat, { options: number[]; standard: number }> = {
  limited: { options: [5, 10, 20, 50], standard: 20 },
  box: { options: [4, 6, 8, 10], standard: 6 },
  pair: { options: [4, 6, 8, 10], standard: 8 },
};

export const CRICKET_FORMAT_LABELS: Record<CricketFormat, string> = {
  limited: 'Limited overs',
  box: 'Box cricket',
  pair: 'Pair (overs match)',
};

/** The overs an innings lasts. */
export function inningsOvers(overs: number | null | undefined): number {
  const n = Math.floor(Number(overs));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_OVERS;
}

/** Wickets that end an innings for a side with `players` in its line-up. */
export function allOutWickets(players: number | null | undefined): number {
  const n = Math.floor(Number(players));
  if (!Number.isFinite(n) || n < 2) return DEFAULT_ALL_OUT;
  return Math.min(n - 1, DEFAULT_ALL_OUT);
}

/** Per-side all-out from a line-up (rows carrying a team_side). */
export function allOutBySide(lineup: Array<{ team_side?: string | null }> | null | undefined): { A: number; B: number } {
  const count = (s: 'A' | 'B') => (lineup ?? []).filter((p) => p.team_side === s).length;
  return { A: allOutWickets(count('A')), B: allOutWickets(count('B')) };
}

/** The cricket format of a match from its stored `format` ("T20", "box", "pair"). */
export function cricketFormatOf(format: string | null | undefined): CricketFormat {
  const f = String(format ?? '').trim().toLowerCase();
  if (f === 'box') return 'box';
  if (f === 'pair') return 'pair';
  return 'limited';
}

/** Is `overs` one the format offers? Anything else is refused at creation. */
export function isOfferedOvers(format: CricketFormat, overs: number | null | undefined): boolean {
  return overs == null || CRICKET_OVERS[format].options.includes(Number(overs));
}

/**
 * F-15 · a chase decided by a DLS revised target (the target the chasing side
 * needs to WIN, as the DLS calculator returns it). It was stored and never
 * read, so a rain-shortened chase was still judged on the full first innings.
 *   runs ≥ target        → the chasing side wins (by the wickets in hand)
 *   runs = target − 1    → a tie
 *   fewer                → the side that batted first wins, by
 *                          target − 1 − runs ("won by N runs (DLS)")
 * Null when there is no usable target.
 */
export function dlsOutcome(
  chasingRuns: number,
  dlsTarget: number | null | undefined,
): { winner: 'chaser' | 'defender' | null; runs: number } | null {
  const t = Math.floor(Number(dlsTarget));
  if (!Number.isFinite(t) || t <= 0) return null;
  const r = Math.max(0, Math.floor(Number(chasingRuns) || 0));
  if (r >= t) return { winner: 'chaser', runs: 0 };
  if (r === t - 1) return { winner: null, runs: 0 };
  return { winner: 'defender', runs: t - 1 - r };
}
