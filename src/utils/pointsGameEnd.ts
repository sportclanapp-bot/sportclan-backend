/**
 * N-R7-S28 · ending a scored basketball game: the named winner can't be the
 * side behind. A level score with a declared winner stays the organiser's call
 * (K2-40: a forfeit or a recorded result) and a level score with no winner is
 * refused already (NEEDS_DECISIVE_WINNER); a result recorded with no play isn't
 * checked; a series is checked by its own games.
 */
type Side = 'A' | 'B';
type Summary = { A?: { score?: number; points?: number }; B?: { score?: number; points?: number }; periods?: unknown[] } | null | undefined;
export function basketballEndRefusal(summary: Summary, winnerSide: Side | null | undefined, names: { A?: string | null; B?: string | null }): { error: string; code: string } | null {
  const pts = (x?: { score?: number; points?: number }) => Number(x?.score ?? x?.points ?? 0) || 0;
  const a = pts(summary?.A); const b = pts(summary?.B);
  const played = (Array.isArray(summary?.periods) && summary!.periods!.length > 0) || a + b > 0;
  if (!played) return null;
  if (a === b) return null;
  const leader: Side = a > b ? 'A' : 'B';
  if (winnerSide && winnerSide !== leader) return { error: `The score says ${names[leader] ?? `Team ${leader}`} won this match.`, code: 'WINNER_NOT_LEADER' };
  return null;
}
