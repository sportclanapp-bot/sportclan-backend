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

/**
 * Does this match end with a shootout when level? A knockout always; BUILD
 * 3.20: a league / group match too when the match can't end level (its rules
 * say drawAllowed: false — turf cups often play it that way).
 */
export function shootoutApplies(sport: string | null | undefined, knockout: boolean, drawAllowed: boolean | null | undefined = true): boolean {
  return (knockout || drawAllowed === false) && (SHOOTOUT_SPORTS as readonly string[]).includes(key(sport));
}

/**
 * Two whole numbers 0..30 that differ — a shootout cannot end level.
 * BUILD 3.18: with the match's kicks each (3 or 5), a tally past them went to
 * sudden death, which ends by exactly one (5–4 after 3 each, not 5–3).
 */
export function validShootout(a: unknown, b: unknown, kicks?: number | null): boolean {
  return shootoutProblem(a, b, kicks) === null;
}

/** Why a shootout tally can't be, in the scorer's words — or null. */
export function shootoutProblem(a: unknown, b: unknown, kicks?: number | null): string | null {
  const ok = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= SHOOTOUT_MAX;
  if (!ok(a) || !ok(b)) return `A shootout score is two whole numbers from 0 to ${SHOOTOUT_MAX}.`;
  if (a === b) return 'A shootout can’t end level.';
  if (kicks && Math.max(a as number, b as number) > kicks && Math.abs((a as number) - (b as number)) !== 1) {
    return `After ${kicks} kicks each it’s sudden death, so it ends by one goal (e.g. ${kicks + 1}–${kicks}).`;
  }
  return null;
}

/** BUILD 3.18: the kicks each before sudden death — football's rules say 3 or 5; otherwise 5. */
export const SHOOTOUT_KICKS = [3, 5] as const;
export function shootoutKicksOf(rules: { penaltyKicks?: number | null } | null | undefined): number {
  return rules?.penaltyKicks === 3 ? 3 : 5;
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
