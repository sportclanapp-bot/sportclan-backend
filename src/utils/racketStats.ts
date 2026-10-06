/**
 * Badminton 7.15 (Oct 2026) · a racket player's career, from the scores:
 * games won and lost, rally points won and lost, and the singles and doubles
 * records apart (BWF-style profile). Badminton, table tennis and pickleball —
 * tennis keeps its serve stats. A walkover or retirement counts in the record,
 * but only the games actually played count as games and points; a team tie
 * counts in neither (the player played only some of its rubbers).
 */
export type RacketMatch = {
  id: string;
  team_a_id: string | null; team_b_id: string | null; winner_team_id: string | null;
  score_summary?: { A?: { sets?: unknown }; B?: { sets?: unknown }; rubbers?: unknown } | null;
};
export type RacketStats = {
  games_won: number; games_lost: number; points_won: number; points_lost: number;
  singles_won: number; singles_lost: number; doubles_won: number; doubles_lost: number;
};

const nums = (x: unknown): number[] => (Array.isArray(x) ? x.map(Number).filter((n) => Number.isFinite(n)) : []);
/** A team tie keeps its rubbers (scoring rollupTie → summary.rubbers). */
const isTie = (m: RacketMatch) => m.score_summary?.rubbers != null;

/** Pure. `side` = my side in each match; `sideSize` = how many played on my side (1 singles, 2 doubles). */
export function racketStats(matches: RacketMatch[], side: Map<string, 'A' | 'B'>, sideSize: Map<string, number>): RacketStats {
  const out: RacketStats = { games_won: 0, games_lost: 0, points_won: 0, points_lost: 0, singles_won: 0, singles_lost: 0, doubles_won: 0, doubles_lost: 0 };
  for (const m of matches) {
    const me = side.get(m.id);
    if (!me || isTie(m)) continue;
    const mine = nums(m.score_summary?.[me]?.sets);
    const theirs = nums(m.score_summary?.[me === 'A' ? 'B' : 'A']?.sets);
    for (let i = 0; i < Math.min(mine.length, theirs.length); i++) {
      out.points_won += mine[i]!;
      out.points_lost += theirs[i]!;
      if (mine[i]! > theirs[i]!) out.games_won++;
      else if (theirs[i]! > mine[i]!) out.games_lost++;
    }
    if (!m.winner_team_id) continue;
    const won = m.winner_team_id === (me === 'A' ? m.team_a_id : m.team_b_id);
    const n = sideSize.get(m.id) ?? 1;
    if (n === 1) won ? out.singles_won++ : out.singles_lost++;
    else if (n === 2) won ? out.doubles_won++ : out.doubles_lost++;
  }
  return out;
}
