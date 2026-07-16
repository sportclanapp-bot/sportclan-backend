import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

// ── Scorer Leaderboard ──────────────────────────────────────────────────────

export async function getScorerLeaderboard(req: Request, res: Response) {
  try {
    // Count matches per scorer (created_by on matches)
    const { data: matches } = await supabase
      .from('matches')
      .select('created_by')
      .eq('status', 'completed');

    const countMap = new Map<string, number>();
    for (const m of matches ?? []) {
      if (!m.created_by) continue;
      countMap.set(m.created_by, (countMap.get(m.created_by) ?? 0) + 1);
    }

    // Simple SQS = matches_scored × 10
    const scorers = Array.from(countMap.entries())
      .map(([userId, count]) => ({ userId, matchesScored: count, sqs: count * 10 }))
      .sort((a, b) => b.sqs - a.sqs)
      .slice(0, 20);

    // Enrich with user info
    const userIds = scorers.map((s) => s.userId);
    if (userIds.length === 0) return res.json({ scorers: [] });

    const { data: users } = await supabase
      .from('users')
      .select('id, name, username, profile_picture_url, city_id')
      .in('id', userIds)
      .is('deleted_at', null); // SC-78: exclude soft-deleted scorers
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    // SC-78: drop scorers whose account is soft-deleted (no user in the map).
    const result = scorers
      .filter((s) => userMap.has(s.userId))
      .map((s, i) => ({
        rank: i + 1,
        user: userMap.get(s.userId) ?? null,
        matchesScored: s.matchesScored,
        sqs: s.sqs,
      }));

    return res.json({ scorers: result });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Performance Insights ────────────────────────────────────────────────────

export async function getUserInsights(req: Request, res: Response) {
  try {
    const { id } = req.params;

    // SC-276: the previous query ordered by an EMBEDDED column
    // (`.order('match.created_at')`). PostgREST can't order the parent rows by a
    // to-one embed, so it errored; because only `data` was destructured (the
    // `error` was ignored), `parts` came back null and EVERY embed-derived field
    // (totalMatches / streaks / formTrend / formLabel) was silently empty for
    // EVERY user. Fix: keep the working embed (it's only the order clause that
    // was invalid), drop the bad order, and sort in JS. Semantics unchanged —
    // ALL completed matches the user played (ranked + casual), decided by
    // winner_team_id — NOT narrowed to ranked.
    type MatchLite = {
      id: string; status: string | null; winner_team_id: string | null;
      team_a_id: string | null; team_b_id: string | null; created_at: string | null;
      score_summary: { winner_side?: 'A' | 'B' } | null;
    };
    const { data: parts } = await supabase
      .from('match_participants')
      .select('team_side, match:matches!inner(id, status, winner_team_id, team_a_id, team_b_id, score_summary, created_at)')
      .eq('user_id', id);

    // Completed matches, newest-first (ISO timestamps sort lexically).
    const completed = (parts ?? [])
      .map((p) => ({ side: (p as { team_side: string }).team_side, m: (p as unknown as { match: MatchLite }).match }))
      .filter((x) => x.m && x.m.status === 'completed')
      .sort((a, b) => (b.m.created_at ?? '').localeCompare(a.m.created_at ?? ''));

    // Result per completed match (newest-first). Two winner signals, unified:
    //   • winner_team_id === my team  → team/ranked win
    //   • score_summary.winner_side === my side → TEAMLESS pickup win (SC-285;
    //     the SAME score-derived signal Z-10/completeMatch counts on the profile)
    // SC-278 guarded `null === null` (a null team + null winner is NOT a win);
    // SC-285 adds the winner_side fallback so a real teamless pickup WIN reads
    // 'W' (not the 'D' the winner_team_id-only test gave), agreeing with the
    // participation card. A loser (some winner signal present, not me) → 'L';
    // no winner at all → 'D'.
    const results: Array<'W' | 'L' | 'D'> = completed.map(({ side, m }) => {
      const myTeamId = side === 'A' ? m.team_a_id : m.team_b_id;
      const winnerSide = m.score_summary?.winner_side ?? null;
      const iWon =
        (myTeamId != null && m.winner_team_id === myTeamId) ||
        (winnerSide != null && winnerSide === side);
      if (iWon) return 'W';
      return (m.winner_team_id != null || winnerSide != null) ? 'L' : 'D';
    });

    // SC-277: currentWinStreak = consecutive wins from the MOST RECENT match.
    // The old loop set it from the OLDEST match (wrong direction) — masked while
    // `completed` was always empty. bestWinStreak = longest run anywhere.
    let currentStreak = 0;
    for (const r of results) { if (r === 'W') currentStreak++; else break; }
    let bestStreak = 0;
    let run = 0;
    for (const r of results) { if (r === 'W') { run++; if (run > bestStreak) bestStreak = run; } else run = 0; }

    // Form trend (last 10 results, newest-first).
    const formTrend = results.slice(0, 10);
    const recentWins = formTrend.slice(0, 5).filter((f) => f === 'W').length;
    const formLabel = recentWins >= 4 ? 'Excellent' : recentWins >= 3 ? 'Good' : recentWins >= 2 ? 'Average' : 'Poor';

    // Rating trend from rating_history
    const { data: ratingHistory } = await supabase
      .from('rating_history')
      .select('new_rating')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(10);
    const ratingTrend = (ratingHistory ?? []).map((r: any) => r.new_rating).reverse();

    // Sport profiles
    const { data: profiles } = await supabase
      .from('user_sport_profiles')
      .select('sport_id, rating, matches_played, wins')
      .eq('user_id', id)
      .order('matches_played', { ascending: false });

    const mostPlayedSportId = profiles?.[0]?.sport_id ?? null;

    return res.json({
      insights: {
        totalMatches: completed.length,
        currentWinStreak: currentStreak,
        bestWinStreak: bestStreak,
        formTrend,
        formLabel,
        ratingTrend,
        mostPlayedSportId,
        sportProfiles: profiles ?? [],
      },
    });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
