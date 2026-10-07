/**
 * Badminton 7.15 (Oct 2026) · a racket player's career, from the scores:
 * games won and lost, rally points won and lost, and the singles and doubles
 * records apart (BWF-style profile). Badminton, table tennis and pickleball —
 * and tennis (Stage 9 · T11), where a "game" here is a set and a "point" a game. A walkover or retirement counts in the record,
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

/**
 * Stage 9 · T11 · a tennis player's aces and double faults, from each match's
 * serve stats (score_summary.serve, per side). In singles the side is the
 * player; in doubles they're the pair's (the pad credits the serving side), so
 * they're kept apart. (The old match_participants serve columns were never
 * written — the profile read 0.)
 */
export type TennisServeStats = { aces: number; double_faults: number; doubles_aces: number; doubles_double_faults: number };
export function tennisServeStats(
  matches: Array<{ id: string; score_summary?: { serve?: Partial<Record<'A' | 'B', { aces?: unknown; double_faults?: unknown }>> } | null }>,
  side: Map<string, 'A' | 'B'>, sideSize: Map<string, number>,
): TennisServeStats {
  const out: TennisServeStats = { aces: 0, double_faults: 0, doubles_aces: 0, doubles_double_faults: 0 };
  for (const m of matches) {
    const me = side.get(m.id);
    const s = me ? m.score_summary?.serve?.[me] : null;
    if (!s) continue;
    const a = Number(s.aces) || 0; const d = Number(s.double_faults) || 0;
    if ((sideSize.get(m.id) ?? 1) === 2) { out.doubles_aces += a; out.doubles_double_faults += d; } else { out.aces += a; out.double_faults += d; }
  }
  return out;
}

