/**
 * BUILD 3.21 · a walkover's score. A football walkover goes down as 3–0 or 5–0
 * (the match's rules), so it counts in goal difference like the turf cups say;
 * other sports keep a walkover scoreless unless their tournament says (4.8).
 * Written by all three walkover paths: completeMatch (walkover: true),
 * abandonMatch (a knockout forfeit) and a team's withdrawal.
 *
 * BUILD 4.8 · a tournament's `settings.walkoverScore` wins: a number of goals /
 * points for the winner (football, hockey, basketball 20–0), or "straight" —
 * the games / sets a win takes in the fixture's length (3–0 in a best of 5,
 * 2–0 in a best of 3) and 1–0 in chess.
 */
import { tieSpecOf, walkoverGoalsOf, type MatchRules } from './matchRules';
import { tieNeed } from './tieCore';
import { bestOfFor, lengthKey, winsNeeded } from './matchLength';

export function walkoverScoreFor(sport: string | null | undefined, rules: MatchRules, tournamentSettings?: unknown): number | null {
  const set = tournamentSettings && typeof tournamentSettings === 'object' ? (tournamentSettings as { walkoverScore?: unknown }).walkoverScore : undefined;
  // N-R7-143 (OBS-C2-1): a chess tournament without the setting (made through the API, or older)
  // takes the sport's default, a straight win (1–0, as the create form fills in): a chess
  // forfeit is always 1–0; it went down with no score ('– – –').
  const w = set == null && lengthKey(sport) === 'chess' ? 'straight' : set;
  if (typeof w === 'number' && w > 0) return w;
  if (w === 'straight') {
    // N-SPP1-TTN-1: a team tie (or a best-of series) is scored in matches — its walkover is the
    // matches the tie needs (Swaythling 5–0), not the games one match needs (3–0).
    const spec = tieSpecOf(sport, rules);
    if (spec) return tieNeed(spec);
    if (lengthKey(sport) === 'chess') return 1;
    const bo = rules.bestOf ?? bestOfFor(sport, null);
    if (bo != null) return winsNeeded(bo);
  }
  return walkoverGoalsOf(sport, rules);
}

/**
 * N-R7-S137 (SP-HOC-044): a walkover in a sport and tournament with no walkover score (hockey
 * without settings.walkoverScore) has no score — the abandoned match's live score in its
 * score_summary is stale (a semi abandoned at 1–0 and given to the side behind). As the app's
 * walkoverScoreless (N-R7-321).
 */
export function walkoverScoreless(decidedBy: string | null | undefined, sport: string | null | undefined, rules: MatchRules, tournamentSettings?: unknown): boolean {
  return decidedBy === 'walkover' && walkoverScoreFor(sport, rules, tournamentSettings) == null;
}

export function withWalkoverScore(
  sport: string | null | undefined,
  rules: MatchRules,
  summary: Record<string, any> | null | undefined,
  winnerSide: 'A' | 'B' | null | undefined,
  tournamentSettings?: unknown,
): Record<string, any> {
  const ss = { ...(summary ?? {}) };
  const goals = walkoverScoreFor(sport, rules, tournamentSettings);
  if (goals == null || !winnerSide) return ss;
  const loser = winnerSide === 'A' ? 'B' : 'A';
  // N-R7-S151 (SIDE-X1b-1): the score it stopped at is kept, so a walkover taken back
  // (an abandoned knockout replayed or its result standing) carries on from it.
  if (!ss.walkover_played) ss.walkover_played = { A: ss.A ?? null, B: ss.B ?? null };
  ss[winnerSide] = { ...(ss[winnerSide] ?? {}), score: goals };
  ss[loser] = { ...(ss[loser] ?? {}), score: 0 };
  ss.walkover_score = { [winnerSide]: goals, [loser]: 0 };
  // N-Q070 (launch test plan): a volleyball walkover in straight sets is each set to nil (FIVB: 25–0;
  // the beach 21–0, as VOLLEYBALL_FOR_DIPAK.md), so it counts in the points ratio like a played match.
  const straight = !!tournamentSettings && typeof tournamentSettings === 'object' && (tournamentSettings as { walkoverScore?: unknown }).walkoverScore === 'straight';
  if (straight && lengthKey(sport) === 'volleyball' && !tieSpecOf(sport, rules)) {
    const to = rules.target ?? 25;
    ss[winnerSide] = { ...ss[winnerSide], sets: Array.from({ length: goals }, () => to) };
    ss[loser] = { ...ss[loser], sets: Array.from({ length: goals }, () => 0) };
    ss.walkover_sets = true;
  }
  return ss;
}

/**
 * N-R7-S151 (SIDE-X1b-1): a walkover taken back. An abandoned knockout match given to one side
 * (football 3–0) and then replayed ('Replay the rest') or left to stand went on showing the
 * walkover's 3–0: the replay is played on from the score it stopped at (0–0), as its page says.
 * The score before the walkover comes back (walkover_played; an older row without it falls back to
 * a goal sport's own goals count), with the walkover marks taken off.
 */
export function withoutWalkover(summary: Record<string, any> | null | undefined): Record<string, any> {
  const ss = { ...(summary ?? {}) };
  if (ss.walkover !== true && !ss.walkover_score && !ss.walkover_played) return ss;
  const was = ss.walkover_played as { A?: unknown; B?: unknown } | undefined;
  const wo = ss.walkover_score as Record<string, unknown> | undefined;
  for (const k of ['A', 'B'] as const) {
    if (was && typeof was === 'object' && k in was) {
      if (was[k] == null) delete ss[k]; else ss[k] = was[k];
    } else if (wo && ss[k] && typeof ss[k] === 'object') {
      const side = { ...ss[k] };
      if (typeof side.goals === 'number') side.score = side.goals; else delete side.score;
      if (ss.walkover_sets) delete side.sets;
      ss[k] = side;
    }
  }
  for (const key of ['walkover', 'walkover_score', 'walkover_sets', 'walkover_played', 'walkover_reason']) delete ss[key];
  return ss;
}
