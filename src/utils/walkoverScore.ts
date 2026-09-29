/**
 * BUILD 3.21 · a walkover's score. A football walkover goes down as 3–0 or 5–0
 * (the match's rules), so it counts in goal difference like the turf cups say;
 * other sports keep a walkover scoreless (BUILD 4.8 gives them theirs).
 * Written by all three walkover paths: completeMatch (walkover: true),
 * abandonMatch (a knockout forfeit) and a team's withdrawal.
 */
import { walkoverGoalsOf, type MatchRules } from './matchRules';

export function withWalkoverScore(
  sport: string | null | undefined,
  rules: MatchRules,
  summary: Record<string, any> | null | undefined,
  winnerSide: 'A' | 'B' | null | undefined,
): Record<string, any> {
  const ss = { ...(summary ?? {}) };
  const goals = walkoverGoalsOf(sport, rules);
  if (goals == null || !winnerSide) return ss;
  const loser = winnerSide === 'A' ? 'B' : 'A';
  ss[winnerSide] = { ...(ss[winnerSide] ?? {}), score: goals };
  ss[loser] = { ...(ss[loser] ?? {}), score: 0 };
  ss.walkover_score = { [winnerSide]: goals, [loser]: 0 };
  return ss;
}
