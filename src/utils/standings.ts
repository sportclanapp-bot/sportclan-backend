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

/**
 * Per-team stats over `matches`. When `scope` is given, only matches between two
 * teams both in `scope` are counted (used to build the head-to-head mini-table).
 */
export function computeStats(teamIds: string[], matches: GMatch[], scope?: Set<string>): Map<string, TeamStat> {
  const table = new Map<string, TeamStat>();
  for (const id of teamIds) {
    table.set(id, { id, played: 0, won: 0, drawn: 0, lost: 0, points: 0, scored: 0, conceded: 0, diff: 0 });
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
  }
  for (const r of table.values()) r.diff = r.scored - r.conceded;
  return table;
}

type Criterion = 'points' | 'wins' | 'score_diff' | 'score_scored' | 'head_to_head';

const GLOBAL_CRITERION: Record<Exclude<Criterion, 'head_to_head'>, (s: TeamStat) => number> = {
  points: (s) => s.points,
  wins: (s) => s.won,
  score_diff: (s) => s.diff,
  score_scored: (s) => s.scored,
};

/** Map a configured tiebreaker_rules token to a known criterion (or null to ignore). */
function mapRule(token: string): Criterion | null {
  const t = String(token).toLowerCase().trim();
  if (t === 'points' || t === 'pts') return 'points';
  if (t === 'head_to_head' || t === 'h2h' || t === 'head2head' || t === 'headtohead') return 'head_to_head';
  if (t === 'score_diff' || t === 'score_difference' || t === 'goal_difference' || t === 'goal_diff' || t === 'gd' || t === 'nrr' || t === 'run_rate') return 'score_diff';
  if (t === 'score_scored' || t === 'score_for' || t === 'goals_for' || t === 'gf' || t === 'runs_scored' || t === 'points_scored') return 'score_scored';
  if (t === 'wins' || t === 'won') return 'wins';
  return null; // 'team_id' and unknowns handled by the terminator
}

const DEFAULT_TIEBREAKS: Criterion[] = ['head_to_head', 'score_diff', 'score_scored'];

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
