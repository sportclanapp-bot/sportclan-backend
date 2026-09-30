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
import { walkoverGoalsOf, type MatchRules } from './matchRules';
import { bestOfFor, lengthKey, winsNeeded } from './matchLength';

export function walkoverScoreFor(sport: string | null | undefined, rules: MatchRules, tournamentSettings?: unknown): number | null {
  const w = tournamentSettings && typeof tournamentSettings === 'object' ? (tournamentSettings as { walkoverScore?: unknown }).walkoverScore : undefined;
  if (typeof w === 'number' && w > 0) return w;
  if (w === 'straight') {
    if (lengthKey(sport) === 'chess') return 1;
    const bo = rules.bestOf ?? bestOfFor(sport, null);
    if (bo != null) return winsNeeded(bo);
  }
  return walkoverGoalsOf(sport, rules);
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
  ss[winnerSide] = { ...(ss[winnerSide] ?? {}), score: goals };
  ss[loser] = { ...(ss[loser] ?? {}), score: 0 };
  ss.walkover_score = { [winnerSide]: goals, [loser]: 0 };
  return ss;
}
