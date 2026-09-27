import { excludeTest, hideTestFor, testUserIdSet } from '../utils/testContent';
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { countsTowardRecord, countParticipantsByMatch } from '../utils/matchCounts';

// ── Scorer Leaderboard ──────────────────────────────────────────────────────

const SCORER_PAGE = 1000;

export async function getScorerLeaderboard(req: Request, res: Response) {
  try {
    // B03 (V245, D3): test scorers don't rank for a real viewer — dropped before
    // the top 20 is taken, so a real scorer fills the slot. B03 device check:
    // nor do test matches (a real scorer's QA matches counted) — skipped here.
    const hideTest = await hideTestFor(req.userId);

    // Count matches per scorer (created_by on matches). B02-F8: paged in
    // 1000s — one unpaged select stopped at PostgREST's row cap and undercounted.
    const matches: Array<{ created_by: string | null }> = [];
    for (let from = 0; ; from += SCORER_PAGE) {
      let mq = supabase
        .from('matches')
        .select('id, created_by')
        .eq('status', 'completed')
        .is('voided_at', null) // SC-424
        .order('id', { ascending: true });
      if (hideTest) mq = excludeTest(mq);
      const { data, error } = await mq.range(from, from + SCORER_PAGE - 1);
      if (error) return res.status(500).json({ error: 'Internal server error' });
      matches.push(...((data ?? []) as Array<{ created_by: string | null }>));
      if (!data || data.length < SCORER_PAGE) break;
    }

    const testScorers = hideTest
      ? await testUserIdSet([...new Set(matches.map((m) => m.created_by as string).filter(Boolean))])
      : new Set<string>();
    const countMap = new Map<string, number>();
    for (const m of matches) {
      if (!m.created_by || testScorers.has(m.created_by as string)) continue;
      countMap.set(m.created_by, (countMap.get(m.created_by) ?? 0) + 1);
    }

    // Simple SQS = matches_scored × 10
    const ranked = Array.from(countMap.entries())
      .map(([userId, count]) => ({ userId, matchesScored: count, sqs: count * 10 }))
      .sort((a, b) => b.sqs - a.sqs || (a.userId < b.userId ? -1 : 1));

    // B02-F8: deleted scorers drop out BEFORE the top 20 is cut (it used to be
    // after, leaving a short list). Walk the ranking in chunks until 20 live.
    const scorers: typeof ranked = [];
    const userMap = new Map<string, any>();
    for (let i = 0; i < ranked.length && scorers.length < 20; i += 40) {
      const chunk = ranked.slice(i, i + 40);
      const { data: users } = await supabase
        .from('users')
        .select('id, name, username, profile_picture_url, city_id')
        .in('id', chunk.map((s) => s.userId))
        .is('deleted_at', null); // SC-78: exclude soft-deleted scorers
      for (const u of users ?? []) userMap.set((u as any).id, u);
      for (const s of chunk) if (userMap.has(s.userId) && scorers.length < 20) scorers.push(s);
    }
    if (scorers.length === 0) return res.json({ scorers: [] });

    const result = scorers.map((s, i) => ({
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
      is_ranked?: boolean | null;
      voided_at?: string | null; // SC-424
    };
    const { data: parts } = await supabase
      .from('match_participants')
      // SC-413: is_ranked needed to apply the SC-283 rule.
      // SC-424: voided_at is selected so countsTowardRecord can exclude it.
      .select('team_side, match:matches!inner(id, status, is_ranked, winner_team_id, team_a_id, team_b_id, score_summary, created_at, voided_at)')
      .eq('user_id', id);

    // SC-413: form/streak are a RECORD, so they obey the same SC-283 rule as
    // matches_played — a casual match with <2 real participants (solo vs a
    // free-text phantom) contributes nothing to your record and must not shape
    // your form either. The activity heatmap deliberately does NOT filter this
    // way: SC-283 treats activity as participation, not skill.
    const partRows = (parts ?? []).map((p) => ({
      side: (p as { team_side: string }).team_side,
      m: (p as unknown as { match: MatchLite }).match,
    }));
    const insightCounts = await countParticipantsByMatch(
      partRows.map((r) => r.m?.id).filter(Boolean) as string[],
    );

    // Completed matches, newest-first (ISO timestamps sort lexically).
    const completed = partRows
      .filter((x) => countsTowardRecord(x.m, insightCounts.get(x.m?.id) ?? 0))
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
      // V041 (visual review): voided matches keep their rating_history row (a
      // restore re-applies it) but must not count here — same filter as advancedStats.
      .select('new_rating, match:matches!inner(voided_at)')
      .eq('user_id', id)
      .is('match.voided_at', null)
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
