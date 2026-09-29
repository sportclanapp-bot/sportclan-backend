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
  // BUILD 3.33 (found on the device): level WITH points on the board — a
  // one-period game offered OVERTIME at 0–0 before a basket was scored.
  return a === b && a + b > 0;
}

/**
 * BUILD 3.35 · fouls. The current period's team fouls (period = period
 * changes so far + 1; FIBA's bonus from the 5th team foul in a period), and each
 * player's fouls in the game — fouled out at `foulOut` (FIBA 5, NBA 6).
 */
export const TEAM_FOUL_BONUS = 5;
export function foulTally(
  events: ReadonlyArray<{ event_type: string; payload?: unknown }>,
  foulOut: number,
): {
  period: number;
  team: { A: number; B: number };
  players: Array<{ id: string; name: string; side: 'A' | 'B'; fouls: number; out: boolean }>;
} {
  let period = 1;
  const team = { A: 0, B: 0 };
  const byId = new Map<string, { id: string; name: string; side: 'A' | 'B'; fouls: number; out: boolean }>();
  for (const ev of events) {
    if (ev.event_type === 'period_change') { period += 1; team.A = 0; team.B = 0; continue; }
    if (ev.event_type !== 'foul') continue;
    const p = (ev.payload ?? {}) as { team_side?: unknown; player_id?: unknown; player_name?: unknown };
    const side: 'A' | 'B' = p.team_side === 'B' ? 'B' : 'A';
    team[side] += 1;
    if (typeof p.player_id !== 'string' || !p.player_id) continue;
    const line = byId.get(p.player_id) ?? { id: p.player_id, name: typeof p.player_name === 'string' && p.player_name ? p.player_name : 'Player', side, fouls: 0, out: false };
    line.fouls += 1;
    line.out = line.fouls >= foulOut;
    byId.set(p.player_id, line);
  }
  return { period, team, players: [...byId.values()] };
}
