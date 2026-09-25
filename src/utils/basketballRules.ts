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
  const p = Math.max(1, Math.floor(n));
  return p <= REGULATION_QUARTERS ? `Q${p}` : `OT${p - REGULATION_QUARTERS}`;
}

/** Is period n an overtime period? */
export function isOvertime(n: number): boolean {
  return Math.floor(n) > REGULATION_QUARTERS;
}

/**
 * May the scorer start the next period after period n? Always within regulation;
 * after Q4 (and after each overtime) only while the score is level — a lead at
 * that point is the result.
 */
export function canStartNextPeriod(n: number, a: number, b: number): boolean {
  if (Math.floor(n) < REGULATION_QUARTERS) return true;
  return a === b;
}
