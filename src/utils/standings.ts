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
  /**
   * Badminton gap 10 · rally points: every game's points, won and lost (from
   * score_summary.A/B.sets), for BWF's "points difference" tie-break. 0 for a
   * sport or match without them.
   */
  rallyFor: number;
  rallyAgainst: number;
  rallyDiff: number;
  /** Badminton 7.16 · games won and lost (every game of every rubber of a tie). */
  gamesFor: number;
  gamesAgainst: number;
  gamesDiff: number;
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

/** Badminton gap 10: each side's rally points over the games played (0 when the summary has none). */
export function rallyPointsOf(m: GMatch): { a: number; b: number } {
  const ss: any = m.score_summary ?? {};
  const sum = (x: unknown) => (Array.isArray(x) ? x.reduce((n: number, v: unknown) => n + (Number.isFinite(Number(v)) ? Number(v) : 0), 0) : 0);
  if (ss.walkover === true) return { a: 0, b: 0 }; // a walkover played no rallies
  return { a: sum(ss?.A?.sets), b: sum(ss?.B?.sets) };
}

/** Badminton 7.16: games each side won, from the games' points (0 for a walkover). */
export function gamesWonOf(m: GMatch): { a: number; b: number } {
  const ss: any = m.score_summary ?? {};
  if (ss.walkover === true) return { a: 0, b: 0 };
  const A = Array.isArray(ss?.A?.sets) ? ss.A.sets.map(Number) : [];
  const B = Array.isArray(ss?.B?.sets) ? ss.B.sets.map(Number) : [];
  let a = 0, b = 0;
  for (let i = 0; i < Math.min(A.length, B.length); i++) { if (A[i] > B[i]) a++; else if (B[i] > A[i]) b++; }
  return { a, b };
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
    // Stage 11 · PB3: a team tie won in its deciding match (MLP's DreamBreaker:
    // 2 to the winner, 1 to the loser) — else volleyball's set score.
    const tie = m.score_summary?.tie;
    const decider = tie && typeof tie === 'object' ? tie.decider === true : winnerScore > 1 && loserScore === winnerScore - 1;
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
      runsScored: 0, oversFaced: 0, runsConceded: 0, oversBowled: 0, nrr: null, rallyFor: 0, rallyAgainst: 0, rallyDiff: 0, gamesFor: 0, gamesAgainst: 0, gamesDiff: 0,
    });
  }
  for (const m of matches) {
    const a = m.team_a_id;
    const b = m.team_b_id;
    // BUILD 4.15: a Swiss bye — one player, marked on its summary — is a win's
    // points and a game played. (A knockout bye isn't marked: it only advances.)
    if (a && !b && !scope && m.score_summary?.bye === true && m.status === 'completed' && table.has(a)) {
      const r = table.get(a)!;
      r.played++; r.won++; r.points += pts.win;
      continue;
    }
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
    const rp = rallyPointsOf(m); // badminton gap 10
    ra.rallyFor += rp.a; ra.rallyAgainst += rp.b;
    rb.rallyFor += rp.b; rb.rallyAgainst += rp.a;
    const gw = gamesWonOf(m); // badminton 7.16
    ra.gamesFor += gw.a; ra.gamesAgainst += gw.b;
    rb.gamesFor += gw.b; rb.gamesAgainst += gw.a;
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
    r.rallyDiff = r.rallyFor - r.rallyAgainst;
    r.gamesDiff = r.gamesFor - r.gamesAgainst;
    r.nrr = netRunRate(r);
  }
  return table;
}

type Criterion = 'points' | 'wins' | 'score_diff' | 'score_scored' | 'head_to_head' | 'score_rate' | 'score_ratio' | 'buchholz' | 'sonneborn_berger' | 'points_diff' | 'games_diff' | 'fair_play' | 'points_won' | 'points_pct' | 'played'
  // Stage 10 · TT4: counted only in the matches between the tied teams.
  | 'h2h_score_diff' | 'h2h_score_scored' | 'h2h_score_ratio' | 'h2h_points_diff' | 'h2h_points_ratio';
const BETWEEN: Record<'h2h_score_diff' | 'h2h_score_scored' | 'h2h_score_ratio' | 'h2h_points_diff' | 'h2h_points_ratio', (s: TeamStat) => number> = {
  h2h_score_diff: (s) => s.diff,
  h2h_score_scored: (s) => s.scored,
  h2h_score_ratio: (s) => (s.conceded > 0 ? s.scored / s.conceded : s.scored > 0 ? 1e9 : 0),
  h2h_points_diff: (s) => s.rallyDiff,
  h2h_points_ratio: (s) => (s.rallyAgainst > 0 ? s.rallyFor / s.rallyAgainst : s.rallyFor > 0 ? 1e9 : 0),
};
const isBetween = (c: Criterion): c is keyof typeof BETWEEN => c in BETWEEN;

/**
 * Stage 8 · F8 · what the ladder needs beyond the matches: each team's fair-play
 * points (0 clean, less is worse — utils/fairPlay), and the order a draw of lots
 * put teams in when nothing else separates them (the organiser records it).
 */
export type RankExtra = {
  fairPlay?: Map<string, number>; lots?: string[];
  /**
   * Stage 11 · PB7 · best next-placed across groups of different sizes: the
   * group matches and the points template. With them, a team's results against
   * the teams placed below the smallest group's size are left out (the AFC /
   * UEFA way), so every candidate is compared on the same number of matches —
   * USA Pickleball: point difference isn't compared across pools of unequal size.
   */
  matches?: GMatch[]; pts?: PointsModel;
};

const GLOBAL_CRITERION: Record<Exclude<Criterion, 'head_to_head' | 'buchholz' | 'sonneborn_berger' | 'fair_play' | keyof typeof BETWEEN>, (s: TeamStat) => number> = {
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
  // Badminton gap 10: BWF's points difference — rally points won minus lost.
  points_diff: (s) => s.rallyDiff,
  // Badminton 7.16: games difference over every rubber of a team tie.
  games_diff: (s) => s.gamesDiff,
  // Stage 9 · T4: tennis's games (the rally sports' points) won, and their
  // share of all played (the ATP's "games %"); and matches played (the ATP
  // Finals rank 2-1 above 2-0 — a withdrawal plays fewer).
  points_won: (s) => s.rallyFor,
  points_pct: (s) => (s.rallyFor + s.rallyAgainst > 0 ? s.rallyFor / (s.rallyFor + s.rallyAgainst) : 0),
  played: (s) => s.played,
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
  if (t === 'points_diff' || t === 'point_difference' || t === 'rally_points_diff' || t === 'points_difference') return 'points_diff'; // badminton gap 10
  if (t === 'games_diff' || t === 'games_difference' || t === 'game_difference') return 'games_diff'; // badminton 7.16
  if (t === 'fair_play' || t === 'fairplay' || t === 'fair_play_points' || t === 'discipline') return 'fair_play'; // Stage 8 · F8
  // Stage 9 · T4.
  if (t === 'points_won' || t === 'games_won' || t === 'total_games' || t === 'rally_points_won') return 'points_won';
  if (t === 'points_pct' || t === 'games_pct' || t === 'game_percentage' || t === 'points_percentage') return 'points_pct';
  if (t === 'played' || t === 'matches_played') return 'played';
  // Stage 10 · TT4.
  if (t === 'h2h_score_diff' || t === 'h2h_goal_difference') return 'h2h_score_diff';
  if (t === 'h2h_score_scored' || t === 'h2h_goals_for') return 'h2h_score_scored';
  if (t === 'h2h_score_ratio' || t === 'h2h_game_ratio' || t === 'h2h_set_ratio') return 'h2h_score_ratio';
  if (t === 'h2h_points_diff') return 'h2h_points_diff';
  if (t === 'h2h_points_ratio') return 'h2h_points_ratio';
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
  teamIds: string[], matches: GMatch[], tiebreakerRules?: any[], pts: PointsModel = DEFAULT_POINTS, extra: RankExtra = {},
): string[] {
  return rankTeamsDetailed(teamIds, matches, tiebreakerRules, pts, extra).order;
}

/**
 * Stage 8 · F8 · the ladder, and the teams still level after every tie-break
 * that no draw of lots has ordered yet (each cluster, best first). Those are
 * placed by a draw of lots the organiser records (`extra.lots`); until then by
 * team id, and the table says they're level.
 */
export function rankTeamsDetailed(
  teamIds: string[], matches: GMatch[], tiebreakerRules?: any[], pts: PointsModel = DEFAULT_POINTS, extra: RankExtra = {},
): { order: string[]; level: string[][]; byLot: string[][] } {
  const levelClusters: string[][] = [];
  const lotClusters: string[][] = [];
  const lotIndex = new Map((extra.lots ?? []).map((id, i) => [id, i]));
  const order = buildOrder(tiebreakerRules);
  const globalStats = computeStats(teamIds, matches, undefined, pts);
  let opps: ReturnType<typeof opponentLog> | null = null;

  function keyMapFor(crit: Criterion, ids: string[]): Map<string, number> {
    if (crit === 'head_to_head') {
      const h2h = computeStats(ids, matches, new Set(ids), pts);
      return new Map(ids.map((id) => [id, h2h.get(id)?.points ?? 0]));
    }
    // Stage 10 · TT4: the same mini-table, read for games / goals / points.
    if (isBetween(crit)) {
      const h2h = computeStats(ids, matches, new Set(ids), pts);
      const fn = BETWEEN[crit];
      return new Map(ids.map((id) => [id, h2h.get(id) ? fn(h2h.get(id)!) : 0]));
    }
    // BUILD 4.2 · Buchholz: the sum of the opponents' points. Sonneborn-Berger:
    // the points of the opponents beaten, plus half those drawn with.
    // Stage 8 · F8: fair-play points (higher is better: 0 is a clean record).
    if (crit === 'fair_play') return new Map(ids.map((id) => [id, extra.fairPlay?.get(id) ?? 0]));
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
      // Stage 8 · F8: a draw of lots the organiser recorded, then the team id.
      if (!ids.every((id) => lotIndex.has(id))) levelClusters.push(ids.slice().sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
      const placed = ids.slice().sort((x, y) => (lotIndex.get(x) ?? Infinity) - (lotIndex.get(y) ?? Infinity) || (x < y ? -1 : x > y ? 1 : 0));
      if (ids.every((id) => lotIndex.has(id))) lotClusters.push(placed); // ordered by the draw, shown as such
      return placed; // team_id terminator
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

  const ordered = rec(teamIds, 0);
  // Report the level clusters in table order.
  const pos = new Map(ordered.map((id, i) => [id, i]));
  levelClusters.sort((a, b) => (pos.get(a[0]!) ?? 0) - (pos.get(b[0]!) ?? 0));
  for (const cl of levelClusters) cl.sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
  lotClusters.sort((a, b) => (pos.get(a[0]!) ?? 0) - (pos.get(b[0]!) ?? 0));
  return { order: ordered, level: levelClusters, byLot: lotClusters };
}

// ── BUILD 4.5 · best next-placed teams across groups ─────────────────────────

/** Round up to a power of two (a knockout's size). */
function pow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * How many places in a groups → knockout bracket the direct qualifiers leave
 * empty (byes): the bracket holds nextPow2(groups × qualifiers), and a group
 * smaller than the qualifier count sends fewer.
 */
export function openKnockoutPlaces(groupSizes: number[], qualifiersPerGroup: number): number {
  const direct = groupSizes.reduce((n, size) => n + Math.min(size, qualifiersPerGroup), 0);
  return Math.max(0, pow2(groupSizes.length * qualifiersPerGroup) - direct);
}

/**
 * BUILD 4.5 · the best teams finishing in `place` (0-based: 2 = third) across
 * the groups, best first, up to `count`. Groups can differ in size, so they're
 * compared per game played — points, then difference, then scored — and the
 * team id settles a dead heat. `rankedGroups` is each group's order.
 */
export function bestPlacedAcrossGroups(
  rankedGroups: string[][], place: number, count: number, stats: Map<string, TeamStat>,
  /** Stage 8: the tournament's tie-break order (as rankTeams), and fair play / lots. */
  tiebreakerRules?: any[], extra: RankExtra = {},
): string[] {
  if (count <= 0) return [];
  // Stage 11 · PB7: groups of different sizes — each candidate's results against
  // teams placed below the smallest group's size don't count.
  const sizes = rankedGroups.map((g) => g.length).filter((n) => n > place); // the groups that have a team in this place
  const smallest = sizes.length ? Math.min(...sizes) : 0;
  if (extra.matches && sizes.some((n) => n !== smallest)) {
    const placeOf = new Map<string, number>();
    for (const g of rankedGroups) g.forEach((id, i) => placeOf.set(id, i));
    const counted = extra.matches.filter((m) => {
      const a = m.team_a_id; const b = m.team_b_id;
      return !!a && !!b && (placeOf.get(a) ?? 0) < smallest && (placeOf.get(b) ?? 0) < smallest;
    });
    stats = computeStats(rankedGroups.flat(), counted, undefined, extra.pts ?? DEFAULT_POINTS);
  }
  const per = (id: string, f: (s: TeamStat) => number) => {
    const s = stats.get(id);
    return s && s.played > 0 ? f(s) / s.played : 0;
  };
  // Stage 8: the same order as the tables, per game played (groups can differ in
  // size); head-to-head, run rate and the chess scores can't compare teams that
  // never met, so they're left out. Then fair play, a draw of lots, the team id.
  const order = tiebreakerRules ? buildOrder(tiebreakerRules) : (['points', 'score_diff', 'score_scored'] as Criterion[]);
  const lotIndex = new Map((extra.lots ?? []).map((id, i) => [id, i]));
  const value = (id: string, c: Criterion): number | null => {
    if (c === 'fair_play') return extra.fairPlay?.get(id) ?? 0;
    if (c === 'head_to_head' || c === 'buchholz' || c === 'sonneborn_berger' || c === 'score_rate' || isBetween(c)) return null; // TT4: teams from different groups never met
    if (c === 'score_ratio') return GLOBAL_CRITERION.score_ratio(stats.get(id) ?? ({} as TeamStat));
    // Stage 9 · T4: a share is already per game; matches played can't compare groups of different sizes.
    if (c === 'points_pct') return GLOBAL_CRITERION.points_pct(stats.get(id) ?? ({ rallyFor: 0, rallyAgainst: 0 } as TeamStat));
    if (c === 'played') return null;
    return per(id, GLOBAL_CRITERION[c]);
  };
  const pool = rankedGroups.map((g) => g[place]).filter((id): id is string => !!id);
  return pool.sort((x, y) => {
    for (const c of order) {
      const vx = value(x, c); const vy = value(y, c);
      if (vx == null || vy == null) continue;
      if (vy !== vx) return vy - vx;
    }
    return (lotIndex.get(x) ?? Infinity) - (lotIndex.get(y) ?? Infinity) || (x < y ? -1 : x > y ? 1 : 0);
  }).slice(0, count);
}

/**
 * Stage 8 · how many best next-placed teams go through: the organiser's number
 * (no more than the groups that have a team in that place), else — with "best
 * next-placed" on — as many as fill the knockout's byes (BUILD 4.5), else none.
 */
export function bestNextCount(s: { bestThirds?: boolean; bestNext?: number }, groupSizes: number[], qualifiersPerGroup: number): number {
  const eligible = groupSizes.filter((n) => n > qualifiersPerGroup).length;
  if (s.bestNext != null) return Math.max(0, Math.min(s.bestNext, eligible));
  if (s.bestThirds) return openKnockoutPlaces(groupSizes, qualifiersPerGroup);
  return 0;
}

/** Stage 8 · the knockout's size for groups → knockout: every direct qualifier plus the best next-placed. */
export function groupsKnockoutSize(groups: number, qualifiersPerGroup: number, bestNext: number | null | undefined, directSeeds = 0): number {
  // Stage 10 · TT2: and the seeds who go straight into the knockout.
  return pow2(groups * qualifiersPerGroup + Math.max(0, Math.min(bestNext ?? 0, groups)) + Math.max(0, directSeeds));
}
