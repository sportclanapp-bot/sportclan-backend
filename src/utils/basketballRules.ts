/**
 * Basketball periods — ONE rule for the app and the server (decision A1).
 *
 * This file is byte-identical in both repos:
 *   app     src/scoring/basketballRules.ts
 *   server  src/utils/basketballRules.ts
 * and both repos run the same fixture table against it (basketballRules test).
 * Edit both, or neither.
 *
 * Four quarters, then overtime periods (OT1, OT2 …) for as long as the score is
 * level at the end of one. A basketball game cannot end level, so without
 * overtime a game tied after Q4 had no way to finish. There is no game clock:
 * periods are a counter the scorer advances, so the copy says "4 quarters",
 * not a length.
 */

export const REGULATION_QUARTERS = 4;

/** "Q3", "OT1", "OT2" … for period n (1-based). */
export function periodLabel(n: number): string {
  return periodLabelOf(n, REGULATION_QUARTERS);
}

/** Is period n an overtime period? */
export function isOvertime(n: number): boolean {
  return isOvertimeOf(n, REGULATION_QUARTERS);
}

/**
 * May the scorer start the next period after period n? Always within regulation;
 * after Q4 (and after each overtime) only while the score is level — a lead at
 * that point is the result.
 */
export function canStartNextPeriod(n: number, a: number, b: number): boolean {
  return canStartNextPeriodOf(n, a, b, REGULATION_QUARTERS);
}

// BUILD 2.3 · the same, for a match whose rules set its regulation periods.
// Separate functions (not an optional argument) so `.map(periodLabel)` can't
// pass an index in as the regulation.

/** BUILD 3.30: named by the match's periods — Q1–Q4, H1/H2, P1–P3; then OT1, OT2 … */
export function periodLabelOf(n: number, regulation: number): string {
  const p = Math.max(1, Math.floor(n));
  if (p > regulation) return `OT${p - regulation}`;
  return regulation === 4 ? `Q${p}` : regulation === 2 ? `H${p}` : `P${p}`;
}

/** BUILD 3.30: "4 quarters", "2 halves", "3 periods", "1 period". */
export function periodsNounOf(regulation: number): string {
  return regulation === 4 ? '4 quarters' : regulation === 2 ? '2 halves' : `${regulation} period${regulation === 1 ? '' : 's'}`;
}

export function isOvertimeOf(n: number, regulation: number): boolean {
  return Math.floor(n) > regulation;
}

export function canStartNextPeriodOf(n: number, a: number, b: number, regulation: number): boolean {
  if (Math.floor(n) < regulation) return true;
  return a === b;
}
