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

    // Get all match participations
    const { data: parts } = await supabase
      .from('match_participants')
      .select('match_id, team_side, batting_order, match:matches!inner(id, status, winner_team_id, team_a_id, team_b_id, score_summary, created_at)')
      .eq('user_id', id)
      .order('match.created_at', { ascending: false } as any)
      .limit(50);

    const completed = (parts ?? []).filter((p: any) => p.match?.status === 'completed');

    // Win streak calculation
    let currentStreak = 0;
    let bestStreak = 0;
    let streak = 0;
    for (const p of completed) {
      const m: any = p.match;
      const myTeamId = p.team_side === 'A' ? m.team_a_id : m.team_b_id;
      const won = m.winner_team_id === myTeamId;
      if (won) { streak++; if (streak > bestStreak) bestStreak = streak; }
      else { streak = 0; }
    }
    currentStreak = streak;

    // Form trend (last 10 match results: W/L)
    const formTrend = completed.slice(0, 10).map((p: any) => {
      const m = p.match;
      const myTeamId = p.team_side === 'A' ? m.team_a_id : m.team_b_id;
      return m.winner_team_id === myTeamId ? 'W' : m.winner_team_id ? 'L' : 'D';
    });

    // Recent form label
    const recentWins = formTrend.slice(0, 5).filter((f: string) => f === 'W').length;
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
