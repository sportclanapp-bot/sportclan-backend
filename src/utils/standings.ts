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
// Points model: win = 3, draw = 1, loss = 0 unless the tournament has a points
// template (BUILD 4.1, pointsFor). A *completed* match with no
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
  /** BUILD 4.1 · no-results counted (only when the template scores them). */
  noResult: number;
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

/**
 * Leading (possibly negative) number of a score value; 0 when absent/non-numeric.
 * BUILD 1.6: a chess half point reads as one — 0.5, "0.5", "½", "1½". It used to
 * take the leading integer only, so a draw's ½ counted as 0 in the score tiebreaks.
 */
export function parseScoreNum(x: any): number {
  if (x == null) return 0;
  const m = String(x).match(/-?\d+(?:\.\d+)?½?|½/u);
  if (!m) return 0;
  if (m[0] === '½') return 0.5;
  if (!m[0].endsWith('½')) return Number(m[0]);
  const whole = Number(m[0].slice(0, -1));
  return m[0].startsWith('-') ? whole - 0.5 : whole + 0.5;
}

/**
 * Points for a result. BUILD 1.6: chess is 1 / ½ / 0; every other sport 3 / 1 / 0.
 * BUILD 4.1: a tournament's points template (settings.points) can also score a
 * no-result (null = not counted, as before), a walkover (null = as a win / loss)
 * and, for volleyball, a win by its set score (`sets`: a straight win, or one
 * that went the distance — the loser one set short).
 */
export type PointsModel = {
  win: number; draw: number; loss: number;
  noResult?: number | null;
  walkoverWin?: number | null;
  walkoverLoss?: number | null;
  sets?: { straight: [number, number]; decider: [number, number] } | null;
};
export const DEFAULT_POINTS: PointsModel = { win: 3, draw: 1, loss: 0 };
export const CHESS_POINTS: PointsModel = { win: 1, draw: 0.5, loss: 0 };
export function pointsModelFor(sportSlug?: string | null): PointsModel {
  return String(sportSlug ?? '').trim().toLowerCase() === 'chess' ? CHESS_POINTS : DEFAULT_POINTS;
}

/** BUILD 4.1 · a tournament's points: its template when it has one, else the sport's default above. */
export function pointsFor(sportSlug: string | null | undefined, settings?: any): PointsModel {
  const p = settings && typeof settings === 'object' ? settings.points : null;
  if (p && typeof p === 'object' && typeof p.win === 'number' && typeof p.draw === 'number' && typeof p.loss === 'number') return p as PointsModel;
  return pointsModelFor(sportSlug);
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
    // BUILD 1.3: all out is the side's own all-out count (line-up − 1), which
    // the summary records as all_out; 10 wickets stays the rule for older rows.
    if (allotted != null && (nested?.all_out === true || Number(nested?.wickets ?? 0) >= 10)) overs = allotted;
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

/** A walkover: marked on its summary (SC-254), or an abandoned match that still has a winner. */
function isWalkover(m: GMatch): boolean {
  return m.score_summary?.walkover === true || (m.status === 'abandoned' && !!m.winner_team_id);
}

/**
 * BUILD 4.1 · [winner's, loser's] points for a decided match. A walkover takes
 * the template's walkover values when it has them; volleyball's set-score
 * template scores a win that went the distance (the loser one set short of the
 * winner) apart from a straight one.
 */
function resultPoints(m: GMatch, pts: PointsModel, winnerScore: number, loserScore: number): [number, number] {
  if (isWalkover(m)) {
    const straight = pts.sets?.straight;
    return [pts.walkoverWin ?? straight?.[0] ?? pts.win, pts.walkoverLoss ?? straight?.[1] ?? pts.loss];
  }
  if (pts.sets) {
    const decider = winnerScore > 1 && loserScore === winnerScore - 1;
    return decider ? pts.sets.decider : pts.sets.straight;
  }
  return [pts.win, pts.loss];
}

/**
 * Per-team stats over `matches`. When `scope` is given, only matches between two
 * teams both in `scope` are counted (used to build the head-to-head mini-table).
 */
export function computeStats(
  teamIds: string[], matches: GMatch[], scope?: Set<string>, pts: PointsModel = DEFAULT_POINTS,
): Map<string, TeamStat> {
  const table = new Map<string, TeamStat>();
  for (const id of teamIds) {
    table.set(id, {
      id, played: 0, won: 0, drawn: 0, lost: 0, points: 0, scored: 0, conceded: 0, diff: 0, noResult: 0,
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
    // BUILD 1.4: an abandoned match with no winner is a no-result — not a
    // played match, no points (the per-sport points template, BUILD 4.1, can
    // give points for one). It used to count as a 1-1 draw here while the
    // server's table left it out, so the crowned champion and the table could
    // disagree. An abandoned match WITH a winner is a walkover: a win.
    // BUILD 4.1: a template that scores a no-result counts it as played, with
    // those points each — and nothing else (no scores, no run rate).
    if (m.status === 'abandoned' && !m.winner_team_id) {
      if (pts.noResult == null) continue;
      const ra = table.get(a)!;
      const rb = table.get(b)!;
      ra.played++; rb.played++; ra.noResult++; rb.noResult++;
      ra.points += pts.noResult; rb.points += pts.noResult;
      continue;
    }
    const ra = table.get(a)!;
    const rb = table.get(b)!;
    const { a: sa, b: sb } = scoresOf(m);
    ra.played++; rb.played++;
    ra.scored += sa; ra.conceded += sb;
    rb.scored += sb; rb.conceded += sa;
    if (m.winner_team_id === a || m.winner_team_id === b) {
      const [w, l] = m.winner_team_id === a ? [ra, rb] : [rb, ra];
      const [wp, lp] = resultPoints(m, pts, m.winner_team_id === a ? sa : sb, m.winner_team_id === a ? sb : sa);
      w.won++; w.points += wp; l.lost++; l.points += lp;
    }
    else { ra.drawn++; rb.drawn++; ra.points += pts.draw; rb.points += pts.draw; }

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

type Criterion = 'points' | 'wins' | 'score_diff' | 'score_scored' | 'head_to_head' | 'score_rate' | 'score_ratio' | 'buchholz' | 'sonneborn_berger';

const GLOBAL_CRITERION: Record<Exclude<Criterion, 'head_to_head' | 'buchholz' | 'sonneborn_berger'>, (s: TeamStat) => number> = {
  points: (s) => s.points,
  wins: (s) => s.won,
  score_diff: (s) => s.diff,
  score_scored: (s) => s.scored,
  // SC-376: NRR. Absent (non-cricket, or cricket with no overs recorded) reads
  // as 0 for every team in the tie, which separates nobody, so the ladder falls
  // straight through to score_diff — i.e. goal difference still decides
  // football exactly as before.
  score_rate: (s) => s.nrr ?? 0,
  // BUILD 4.2: scored ÷ conceded — volleyball's set ratio, table tennis's
  // game ratio. Nothing conceded reads as a very large ratio (or 0 with
  // nothing scored either), never a division by zero.
  score_ratio: (s) => (s.conceded > 0 ? s.scored / s.conceded : s.scored > 0 ? 1e9 : 0),
};

/**
 * BUILD 4.2 · each team's played opponents and results, counted by the same
 * rules as computeStats (a no-result is no game). Chess's Buchholz and
 * Sonneborn-Berger are built from it.
 */
function opponentLog(teamIds: string[], matches: GMatch[]): Map<string, Array<{ opp: string; res: 'w' | 'd' | 'l' }>> {
  const inSet = new Set(teamIds);
  const log = new Map<string, Array<{ opp: string; res: 'w' | 'd' | 'l' }>>(teamIds.map((id) => [id, []]));
  for (const m of matches) {
    const a = m.team_a_id;
    const b = m.team_b_id;
    if (!a || !b || !inSet.has(a) || !inSet.has(b)) continue;
    const terminal = m.status === 'completed' || m.status === 'abandoned';
    if (!terminal && !m.winner_team_id) continue;
    if (m.status === 'abandoned' && !m.winner_team_id) continue;
    const ra = m.winner_team_id === a ? 'w' : m.winner_team_id === b ? 'l' : 'd';
    const rb = ra === 'w' ? 'l' : ra === 'l' ? 'w' : 'd';
    log.get(a)!.push({ opp: b, res: ra });
    log.get(b)!.push({ opp: a, res: rb });
  }
  return log;
}

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
  // BUILD 4.2
  if (t === 'score_ratio' || t === 'set_ratio' || t === 'game_ratio' || t === 'goal_ratio') return 'score_ratio';
  if (t === 'buchholz') return 'buchholz';
  if (t === 'sonneborn_berger' || t === 'sb' || t === 'sonneborn-berger') return 'sonneborn_berger';
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
export function rankTeams(
  teamIds: string[], matches: GMatch[], tiebreakerRules?: any[], pts: PointsModel = DEFAULT_POINTS,
): string[] {
  const order = buildOrder(tiebreakerRules);
  const globalStats = computeStats(teamIds, matches, undefined, pts);
  let opps: ReturnType<typeof opponentLog> | null = null;

  function keyMapFor(crit: Criterion, ids: string[]): Map<string, number> {
    if (crit === 'head_to_head') {
      const h2h = computeStats(ids, matches, new Set(ids), pts);
      return new Map(ids.map((id) => [id, h2h.get(id)?.points ?? 0]));
    }
    // BUILD 4.2 · Buchholz: the sum of the opponents' points. Sonneborn-Berger:
    // the points of the opponents beaten, plus half those drawn with.
    if (crit === 'buchholz' || crit === 'sonneborn_berger') {
      opps = opps ?? opponentLog(teamIds, matches);
      const ptsOf = (id: string) => globalStats.get(id)?.points ?? 0;
      return new Map(ids.map((id) => [id, (opps!.get(id) ?? []).reduce((sum, o) => sum + (
        crit === 'buchholz' ? ptsOf(o.opp) : o.res === 'w' ? ptsOf(o.opp) : o.res === 'd' ? ptsOf(o.opp) / 2 : 0
      ), 0)]));
    }
    const fn = GLOBAL_CRITERION[crit];
    return new Map(ids.map((id) => [id, fn(globalStats.get(id)!)]));
  }

  function rec(ids: string[], level: number): string[] {
    if (ids.length <= 1) return ids;
    if (level >= order.length) {
      return ids.slice().sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)); // team_id terminator
    }
    const keys = keyMapFor(order[level]!, ids); // guarded by the length check above
    const sorted = ids.slice().sort((x, y) => keys.get(y)! - keys.get(x)!);
    // cluster consecutive equal keys
    const clusters: string[][] = [];
    for (const id of sorted) {
      const last = clusters[clusters.length - 1];
      if (last && keys.get(last[0]!)! === keys.get(id)!) last.push(id); // a cluster is never empty
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
