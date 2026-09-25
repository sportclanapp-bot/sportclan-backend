/**
 * Penalty shootouts — ONE rule for the app and the server (decision A2).
 *
 * This file is byte-identical in both repos:
 *   app     src/scoring/shootoutRules.ts
 *   server  src/utils/shootoutRules.ts
 * and both repos run the same fixture table against it (shootoutRules test).
 * Edit both, or neither.
 *
 * A football or hockey match in a KNOCKOUT tournament must produce a winner —
 * the bracket advances one side — so a match level on goals is decided by a
 * shootout, recorded as its score (e.g. 4–3). Casual matches, league and group
 * matches stay draws: no shootout there.
 */

export type ShootoutSide = 'A' | 'B';

export const SHOOTOUT_SPORTS = ['football', 'hockey'] as const;
/** A shootout score is a whole number of goals in this range. */
export const SHOOTOUT_MAX = 30;

const key = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[-_\s]/g, '');

/** Does this match end with a shootout when level? */
export function shootoutApplies(sport: string | null | undefined, knockout: boolean): boolean {
  return knockout && (SHOOTOUT_SPORTS as readonly string[]).includes(key(sport));
}

/** Two whole numbers 0..30 that differ — a shootout cannot end level. */
export function validShootout(a: unknown, b: unknown): boolean {
  const ok = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= SHOOTOUT_MAX;
  return ok(a) && ok(b) && a !== b;
}

export function shootoutWinner(a: number, b: number): ShootoutSide {
  return a > b ? 'A' : 'B';
}

/** "Lions won 2–2 (4–3 pens)" / "(4–3 shootout)" for hockey. */
export function shootoutResultText(args: {
  sport: string | null | undefined;
  winnerName: string;
  goals: { A: number; B: number };
  shootout: { A: number; B: number };
}): string {
  const { goals, shootout } = args;
  const hi = Math.max(shootout.A, shootout.B);
  const lo = Math.min(shootout.A, shootout.B);
  const word = key(args.sport) === 'hockey' ? 'shootout' : 'pens';
  return `${args.winnerName} won ${goals.A}–${goals.B} (${hi}–${lo} ${word})`;
}
