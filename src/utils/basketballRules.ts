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
 *
 * Stage 15 · BB2 / BB3 (FIBA OBR 2026, 3x3 2026) · each foul has a kind:
 *   personal · technical (Category 1) · technical2 (Category 2) · flagrant (was
 *   unsportsmanlike) · disruptive · disqualifying — a player's, each a team foul
 *   and one towards fouling out; coach ("C") and bench ("B") — the head coach's.
 * A player is ejected after `ejectAfter` Category 1 technicals and flagrants
 * together (3x3: flagrants only), or at once for a disqualifying foul; the head
 * coach after `coachC` "C"s, or `coachB` technicals that are "B"s or include a
 * "C". Overtime carries on the last regulation period's team fouls (FIBA 41.2;
 * a bug before Stage 15: it started again). In 3x3 a flagrant is two team fouls.
 */
export const TEAM_FOUL_BONUS = 5;
export type FoulKind = 'personal' | 'technical' | 'technical2' | 'flagrant' | 'disruptive' | 'disqualifying' | 'coach' | 'bench';
export const FOUL_KINDS: ReadonlyArray<{ key: FoulKind; label: string; short: string; coach?: boolean }> = [
  { key: 'personal', label: 'Personal', short: 'P' },
  { key: 'technical', label: 'Technical', short: 'T' },
  { key: 'technical2', label: 'Technical (Category 2)', short: 'T2' },
  { key: 'flagrant', label: 'Flagrant', short: 'F' },
  { key: 'disruptive', label: 'Disruptive', short: 'DF' },
  { key: 'disqualifying', label: 'Disqualifying', short: 'D' },
  { key: 'coach', label: 'Coach technical (C)', short: 'C', coach: true },
  { key: 'bench', label: 'Bench technical (B)', short: 'B', coach: true },
];
export const foulKindOf = (x: unknown): FoulKind => (FOUL_KINDS.some((k) => k.key === x) ? x as FoulKind : 'personal');
export type FoulOpts = { regulation?: number; ejectAfter?: number; ejectCounts?: 'tech_flagrant' | 'flagrant'; coachC?: number; coachB?: number; flagrantTeamFouls?: number };
export function foulTally(
  events: ReadonlyArray<{ event_type: string; payload?: unknown }>,
  foulOut: number,
  opts: FoulOpts = {},
): {
  period: number;
  team: { A: number; B: number };
  players: Array<{ id: string; name: string; side: 'A' | 'B'; fouls: number; out: boolean; ejected?: boolean; why?: string }>;
  coach: { A: { c: number; b: number; out: boolean }; B: { c: number; b: number; out: boolean } };
} {
  let period = 1;
  const team = { A: 0, B: 0 };
  const after = opts.ejectAfter ?? 2; const counts = opts.ejectCounts ?? 'tech_flagrant';
  const coachC = opts.coachC ?? 2; const coachB = opts.coachB ?? 3;
  const coach = { A: { c: 0, b: 0, out: false }, B: { c: 0, b: 0, out: false } };
  const byId = new Map<string, { id: string; name: string; side: 'A' | 'B'; fouls: number; out: boolean; ejected?: boolean; why?: string; ej: number }>();
  for (const ev of events) {
    if (ev.event_type === 'period_change') {
      period += 1;
      // Overtime carries on the last regulation period's count (FIBA 41.2.3).
      if (opts.regulation == null || period <= opts.regulation) { team.A = 0; team.B = 0; }
      continue;
    }
    if (ev.event_type !== 'foul') continue;
    const p = (ev.payload ?? {}) as { team_side?: unknown; player_id?: unknown; player_name?: unknown; kind?: unknown };
    const side: 'A' | 'B' = p.team_side === 'B' ? 'B' : 'A';
    const kind = foulKindOf(p.kind);
    if (kind === 'coach' || kind === 'bench') {
      const c = coach[side];
      if (kind === 'coach') c.c += 1; else c.b += 1;
      c.out = c.c >= coachC || c.c + c.b >= coachB; // FIBA 36.3.2: 2 coach C, or 3 in any mix with bench B
      continue;
    }
    team[side] += kind === 'flagrant' && opts.flagrantTeamFouls ? opts.flagrantTeamFouls : 1;
    if (typeof p.player_id !== 'string' || !p.player_id) continue;
    const line = byId.get(p.player_id) ?? { id: p.player_id, name: typeof p.player_name === 'string' && p.player_name ? p.player_name : 'Player', side, fouls: 0, out: false, ej: 0 };
    line.fouls += 1;
    line.out = line.out || line.fouls >= foulOut;
    if (kind === 'flagrant' || (kind === 'technical' && counts === 'tech_flagrant')) line.ej += 1;
    if (!line.ejected && kind === 'disqualifying') { line.ejected = true; line.why = 'a disqualifying foul'; }
    if (!line.ejected && line.ej >= after) { line.ejected = true; line.why = counts === 'flagrant' ? `${after} flagrant fouls` : `${after} technical or flagrant fouls`; }
    if (line.ejected) line.out = true;
    byId.set(p.player_id, line);
  }
  return { period, team, players: [...byId.values()].map(({ ej: _ej, ...x }) => x), coach };
}

/**
 * Stage 15 · BB1 · a team's time-outs left now, from the match's rules (FIBA
 * 5x5: 2 in the first half, 3 in the second — at most 2 once the clock shows
 * 2:00 or less in the last regulation period — 1 an overtime; 3x3: 1 a game,
 * carried into overtime). Each time-out event carries its period and whether
 * it was taken in those last minutes (`late`), so the count needs no clock.
 */
export type TimeoutRulesLite = { firstHalf?: number | null; secondHalf?: number | null; perPeriod?: number | null; perGame?: number | null; perOvertime?: number | null; lateMinutes?: number | null; lateMax?: number | null; carry?: boolean };
export function timeoutsLeft(
  rules: TimeoutRulesLite,
  events: ReadonlyArray<{ event_type: string; payload?: unknown }>,
  side: 'A' | 'B',
  period: number,
  regulation: number,
  /** Seconds left in the period on the clock, when there's a clock; the late limit needs it. */
  secondsLeft: number | null,
): { left: number | null; why: string | null } {
  const taken: Array<{ period: number; late: boolean }> = [];
  let p = 1;
  for (const ev of events) {
    if (ev.event_type === 'period_change') { p += 1; continue; }
    if (ev.event_type !== 'timeout') continue;
    const pl = (ev.payload ?? {}) as { team_side?: unknown; late?: unknown };
    if ((pl.team_side === 'B' ? 'B' : 'A') !== side) continue;
    taken.push({ period: p, late: pl.late === true });
  }
  const ot = period > regulation;
  const n = (x: number | null | undefined) => (x == null ? null : x);
  const candidates: Array<{ left: number; why: string }> = [];
  if (rules.perGame != null) {
    // 3x3: one a game; carried into overtime it's the same pool, else overtime has its own.
    const sameP = !ot || rules.carry;
    const pool = sameP ? rules.perGame : rules.perOvertime ?? 0;
    const used = sameP ? taken.length : taken.filter((t) => t.period === period).length;
    candidates.push({ left: Math.max(0, pool - used), why: pool === 1 ? 'their one time-out' : `all ${pool} time-outs` });
  } else if (ot) {
    if (rules.perOvertime != null) candidates.push({ left: Math.max(0, rules.perOvertime - taken.filter((t) => t.period === period).length), why: rules.perOvertime === 1 ? 'their time-out this overtime' : `all ${rules.perOvertime} time-outs this overtime` });
  } else {
    const halfOf = (q: number) => (q <= Math.ceil(regulation / 2) ? 1 : 2);
    const half = halfOf(period);
    const allowance = half === 1 ? n(rules.firstHalf) : n(rules.secondHalf);
    if (allowance != null) candidates.push({ left: Math.max(0, allowance - taken.filter((t) => t.period <= regulation && halfOf(t.period) === half).length), why: half === 1 ? `all ${allowance} first-half time-outs` : `all ${allowance} second-half time-outs` });
    if (rules.perPeriod != null) candidates.push({ left: Math.max(0, rules.perPeriod - taken.filter((t) => t.period === period).length), why: `all ${rules.perPeriod} time-outs this period` });
    // FIBA: at most `lateMax` once the clock shows `lateMinutes` or less in the last regulation period.
    if (period === regulation && rules.lateMinutes != null && rules.lateMax != null && secondsLeft != null && secondsLeft <= rules.lateMinutes * 60) {
      candidates.push({ left: Math.max(0, rules.lateMax - taken.filter((t) => t.period === period && t.late).length), why: `the ${rules.lateMax} allowed in the last ${rules.lateMinutes} minutes` });
    }
  }
  if (!candidates.length) return { left: null, why: null };
  const min = candidates.reduce((a, b) => (b.left < a.left ? b : a));
  return { left: min.left, why: min.left === 0 ? min.why : null };
}

/** Stage 15 · BB3 · 3x3 overtime: points each side has scored since overtime began (first to N wins). */
export function overtimePoints(events: ReadonlyArray<{ event_type: string; payload?: unknown }>, regulation: number): { A: number; B: number } | null {
  let p = 1; const pts = { A: 0, B: 0 };
  for (const ev of events) {
    if (ev.event_type === 'period_change') { p += 1; continue; }
    if (p <= regulation || ev.event_type !== 'score') continue;
    const pl = (ev.payload ?? {}) as { team_side?: unknown; value?: unknown };
    pts[pl.team_side === 'B' ? 'B' : 'A'] += Number(pl.value ?? 0) || 0;
  }
  return p > regulation ? pts : null;
}

/** Stage 15 · BB9 · the alternating possession arrow: the side it points to now (a note sets or flips it), or null before the jump ball. */
export function possessionArrow(events: ReadonlyArray<{ event_type: string; payload?: unknown }>): 'A' | 'B' | null {
  let arrow: 'A' | 'B' | null = null;
  for (const ev of events) {
    if (ev.event_type !== 'note') continue;
    const pl = (ev.payload ?? {}) as { kind?: unknown; team_side?: unknown };
    if (pl.kind === 'arrow') arrow = pl.team_side === 'B' ? 'B' : 'A';
    else if (pl.kind === 'arrow_flip' && arrow) arrow = arrow === 'A' ? 'B' : 'A';
  }
  return arrow;
}
