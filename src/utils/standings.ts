// SC-89: shared group-standings ranking ladder, used by BOTH the qualification
// path (maybeSeedKnockout) and the display path (getTournamentStandings) so they
// always agree.
//
// Ladder: Points → [configured tiebreaker_rules OR default: head-to-head →
// score-difference → score-scored] → team_id (final deterministic terminator).
// Points is always the primary key; team_id guarantees a total order so nothing
// ever strands. Head-to-head is a mini-table computed among ONLY the currently
// tied teams, recomputed as the tie shrinks (standard cascade).
//
// Points model: win = 3, draw = 1, loss = 0. A *completed* match with no
// winner_team_id is a draw. Per-team scores come from score_summary
// (team_a_score / team_b_score, or A.score / B.score) — populated by the live
// scorer; absent for organiser fixture-editor results, which then contribute 0
// to score-diff (it simply falls through to the next criterion).

export type GMatch = {
  team_a_id: string | null;
  team_b_id: string | null;
  winner_team_id: string | null;
  status?: string | null;
  score_summary?: any;
  /** Allotted overs per side (cricket). Needed for the ICC all-out rule below. */
  overs?: number | null;
};

export type TeamStat = {
  id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  points: number;
  scored: number;
  conceded: number;
  diff: number;
  // SC-376 · net run rate inputs. Accumulated across the whole tournament and
  // divided ONCE at the end — NRR is a rate over aggregate runs and aggregate
  // overs, never an average of per-match rates.
  runsScored: number;
  oversFaced: number;
  runsConceded: number;
  oversBowled: number;
  /** runsScored/oversFaced − runsConceded/oversBowled. null when no overs are known. */
  nrr: number | null;
};

/** Leading (possibly negative) integer of a score value; 0 when absent/non-numeric. */
export function parseScoreNum(x: any): number {
  if (x == null) return 0;
  const m = String(x).match(/-?\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function scoresOf(m: GMatch): { a: number; b: number } {
  const ss: any = m.score_summary ?? {};
  return {
    a: parseScoreNum(ss.team_a_score ?? ss?.A?.score),
    b: parseScoreNum(ss.team_b_score ?? ss?.B?.score),
  };
}

// ── SC-376 · net run rate ──────────────────────────────────────────────────
// THE BUG THIS REPLACES: the standings table DISPLAYED NRR but ranked on
// `scored - conceded`, a raw run difference, because mapRule sent 'nrr' to
// score_diff and rankTeams had no concept of a rate. A side making 300 off 40
// overs has a better NRR than one making 310 off 60, but a worse run
// difference — so the order could contradict the column the user was reading.
// NRR now lives HERE, in the one function both the display and the ranking
// call, so the two cannot drift apart again (the SC-89 invariant).
//
// Overs for a side come from, in order:
//   1. an explicit flat `team_a_overs` / `team_b_overs` (organiser fixture editor)
//   2. the live scorer's legal-delivery count: balls / 6
// and neither being present means the overs are UNKNOWN for that match, so it
// contributes nothing to NRR. It is not guessed — a fabricated divisor produces
// a confident wrong number, which is worse than an absent one.

/** Overs as a real number from cricket's `o.b` notation: 4.3 overs = 4.5 overs. */
export function parseOversNum(x: any): number | null {
  if (x == null) return null;
  const n = Number(String(x).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  const whole = Math.floor(n);
  const balls = Math.round((n - whole) * 10);
  if (balls >= 6) return n;            // already decimal overs, not o.b notation
  return whole + balls / 6;
}

type SideRuns = { runs: number; overs: number | null };

/**
 * Runs and overs actually used by each side of a cricket fixture.
 *
 * ICC all-out rule: a side dismissed inside its allotted overs is treated as
 * having batted the FULL quota, so being bowled out cheaply cannot flatter its
 * run rate. Applied only when the quota (`matches.overs`) is known.
 */
export function inningsOf(m: GMatch): { a: SideRuns; b: SideRuns } {
  const ss: any = m.score_summary ?? {};
  const allotted = typeof m.overs === 'number' && m.overs > 0 ? m.overs : null;

  const sideOf = (flatScore: any, flatOvers: any, nested: any): SideRuns => {
    const runs = parseScoreNum(flatScore ?? nested?.score ?? nested?.runs);
    let overs = parseOversNum(flatOvers);
    if (overs == null && nested?.balls != null && Number.isFinite(Number(nested.balls))) {
      overs = Number(nested.balls) / 6;
    }
    // All out → charge the full quota (ICC).
    if (allotted != null && Number(nested?.wickets ?? 0) >= 10) overs = allotted;
    return { runs, overs };
  };

  return {
    a: sideOf(ss.team_a_score, ss.team_a_overs, ss?.A),
    b: sideOf(ss.team_b_score, ss.team_b_overs, ss?.B),
  };
}

/** The NRR of a completed table row, or null when no overs were ever recorded. */
export function netRunRate(s: Pick<TeamStat, 'runsScored' | 'oversFaced' | 'runsConceded' | 'oversBowled'>): number | null {
  if (!(s.oversFaced > 0) || !(s.oversBowled > 0)) return null;
  return Number((s.runsScored / s.oversFaced - s.runsConceded / s.oversBowled).toFixed(3));
}

/**
 * Per-team stats over `matches`. When `scope` is given, only matches between two
 * teams both in `scope` are counted (used to build the head-to-head mini-table).
 */
export function computeStats(teamIds: string[], matches: GMatch[], scope?: Set<string>): Map<string, TeamStat> {
  const table = new Map<string, TeamStat>();
  for (const id of teamIds) {
    table.set(id, {
      id, played: 0, won: 0, drawn: 0, lost: 0, points: 0, scored: 0, conceded: 0, diff: 0,
      runsScored: 0, oversFaced: 0, runsConceded: 0, oversBowled: 0, nrr: null,
    });
  }
  for (const m of matches) {
    const a = m.team_a_id;
    const b = m.team_b_id;
    if (!a || !b || !table.has(a) || !table.has(b)) continue;
    if (scope && (!scope.has(a) || !scope.has(b))) continue;
    // Only decided/played matches count. A completed match with no winner = draw.
    const terminal = m.status === 'completed' || m.status === 'abandoned';
    if (!terminal && !m.winner_team_id) continue;
    const ra = table.get(a)!;
    const rb = table.get(b)!;
    const { a: sa, b: sb } = scoresOf(m);
    ra.played++; rb.played++;
    ra.scored += sa; ra.conceded += sb;
    rb.scored += sb; rb.conceded += sa;
    if (m.winner_team_id === a) { ra.won++; ra.points += 3; rb.lost++; }
    else if (m.winner_team_id === b) { rb.won++; rb.points += 3; ra.lost++; }
    else { ra.drawn++; rb.drawn++; ra.points += 1; rb.points += 1; }

    // SC-376: NRR inputs. Only counted when BOTH sides' overs are known —
    // half a fixture would put runs into the numerator with no matching
    // denominator and silently skew the rate.
    const inn = inningsOf(m);
    if (inn.a.overs != null && inn.b.overs != null && (inn.a.overs > 0 || inn.b.overs > 0)) {
      ra.runsScored += inn.a.runs; ra.oversFaced += inn.a.overs;
      ra.runsConceded += inn.b.runs; ra.oversBowled += inn.b.overs;
      rb.runsScored += inn.b.runs; rb.oversFaced += inn.b.overs;
      rb.runsConceded += inn.a.runs; rb.oversBowled += inn.a.overs;
    }
  }
  for (const r of table.values()) {
    r.diff = r.scored - r.conceded;
    r.nrr = netRunRate(r);
  }
  return table;
}

type Criterion = 'points' | 'wins' | 'score_diff' | 'score_scored' | 'head_to_head' | 'score_rate';

const GLOBAL_CRITERION: Record<Exclude<Criterion, 'head_to_head'>, (s: TeamStat) => number> = {
  points: (s) => s.points,
  wins: (s) => s.won,
  score_diff: (s) => s.diff,
  score_scored: (s) => s.scored,
  // SC-376: NRR. Absent (non-cricket, or cricket with no overs recorded) reads
  // as 0 for every team in the tie, which separates nobody, so the ladder falls
  // straight through to score_diff — i.e. goal difference still decides
  // football exactly as before.
  score_rate: (s) => s.nrr ?? 0,
};

/** Map a configured tiebreaker_rules token to a known criterion (or null to ignore). */
function mapRule(token: string): Criterion | null {
  const t = String(token).toLowerCase().trim();
  if (t === 'points' || t === 'pts') return 'points';
  if (t === 'head_to_head' || t === 'h2h' || t === 'head2head' || t === 'headtohead') return 'head_to_head';
  // SC-376: 'nrr' means the RATE, not the run difference. It used to map to
  // score_diff, which is why cricket ranked on `scored - conceded` while the
  // table displayed NRR.
  if (t === 'nrr' || t === 'run_rate' || t === 'net_run_rate' || t === 'netrunrate') return 'score_rate';
  if (t === 'score_diff' || t === 'score_difference' || t === 'goal_difference' || t === 'goal_diff' || t === 'gd') return 'score_diff';
  if (t === 'score_scored' || t === 'score_for' || t === 'goals_for' || t === 'gf' || t === 'runs_scored' || t === 'points_scored') return 'score_scored';
  if (t === 'wins' || t === 'won') return 'wins';
  return null; // 'team_id' and unknowns handled by the terminator
}

// SC-376: NRR sits ahead of raw score difference. It is a no-op for every sport
// that records no overs (score_rate is 0 across the tie → no separation → the
// ladder falls through to score_diff), so this changes cricket only.
const DEFAULT_TIEBREAKS: Criterion[] = ['head_to_head', 'score_rate', 'score_diff', 'score_scored'];

/** Full ordering: points primary, then configured/default tiebreaks (deduped). team_id is the terminator, applied in rankTeams. */
export function buildOrder(tiebreakerRules?: any[]): Criterion[] {
  const configured = Array.isArray(tiebreakerRules)
    ? (tiebreakerRules.map((x) => mapRule(x)).filter(Boolean) as Criterion[])
    : [];
  const tiebreaks = configured.length ? configured : DEFAULT_TIEBREAKS;
  const order: Criterion[] = ['points', ...tiebreaks];
  return order.filter((v, i) => order.indexOf(v) === i);
}

/**
 * Rank teamIds best-first using the ladder. team_id lexicographic order is the
 * final deterministic terminator so a group can never strand on a tie.
 */
export function rankTeams(teamIds: string[], matches: GMatch[], tiebreakerRules?: any[]): string[] {
  const order = buildOrder(tiebreakerRules);
  const globalStats = computeStats(teamIds, matches);

  function keyMapFor(crit: Criterion, ids: string[]): Map<string, number> {
    if (crit === 'head_to_head') {
      const h2h = computeStats(ids, matches, new Set(ids));
      return new Map(ids.map((id) => [id, h2h.get(id)?.points ?? 0]));
    }
    const fn = GLOBAL_CRITERION[crit];
    return new Map(ids.map((id) => [id, fn(globalStats.get(id)!)]));
  }

  function rec(ids: string[], level: number): string[] {
    if (ids.length <= 1) return ids;
    if (level >= order.length) {
      return ids.slice().sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)); // team_id terminator
    }
    const keys = keyMapFor(order[level], ids);
    const sorted = ids.slice().sort((x, y) => keys.get(y)! - keys.get(x)!);
    // cluster consecutive equal keys
    const clusters: string[][] = [];
    for (const id of sorted) {
      const last = clusters[clusters.length - 1];
      if (last && keys.get(last[0])! === keys.get(id)!) last.push(id);
      else clusters.push([id]);
    }
    if (clusters.length === 1) return rec(ids, level + 1); // no separation → next criterion
    // separated → re-rank each still-tied cluster from the top (H2H recomputed on
    // the smaller set). Terminates: every cluster is strictly smaller than ids.
    const out: string[] = [];
    for (const cl of clusters) out.push(...(cl.length === 1 ? cl : rec(cl, 0)));
    return out;
  }

  return rec(teamIds, 0);
}
