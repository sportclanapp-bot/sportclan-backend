import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

// GET /leaderboard
// Query:
//   sport_id   (required) — which sport to rank.
//   scope      = 'global' (default) | 'city'
//   period     = 'alltime' (default) | 'monthly' — monthly only counts matches
//                in the current calendar month.
//   limit      — page size (1-50, default 20).
//
// For the 'alltime' path we read pre-aggregated ELO from user_sport_profiles.
// For 'monthly' we compute a live rating delta per user over the current
// calendar month from rating_history and rank by that delta. This keeps the
// query cheap — monthly tables don't exist yet.
export async function getLeaderboard(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { sport_id, limit = '20' } = req.query as Record<string, string | undefined>;
    const scope = ((req.query.scope as string) || 'global').toLowerCase();
    const period = ((req.query.period as string) || 'alltime').toLowerCase();
    // Gender category filter: men, women, or open (default=all)
    const genderCategory = (req.query.gender_category as string | undefined) || null;
    if (!sport_id) return res.status(400).json({ error: 'sport_id is required' });

    const pageSize = Math.min(parseInt(limit, 10) || 20, 50);

    // For city scope we need the requester's city to filter users. The filter
    // runs after we fetch the leaderboard rows so that ranks stay dense.
    let myCityId: string | null = null;
    if (scope === 'city') {
      const { data: me } = await supabase
        .from('users')
        .select('city_id')
        .eq('id', userId)
        .maybeSingle();
      myCityId = me?.city_id ?? null;
    }

    type Row = {
      user_id: string;
      rating: number;
      matches_played: number;
      wins: number;
    };
    let profiles: Row[] = [];

    if (period === 'monthly') {
      // Current calendar month window.
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const { data: deltas, error: dErr } = await supabase
        .from('rating_history')
        .select('user_id, delta, new_rating')
        .eq('sport_id', sport_id)
        .gte('created_at', startOfMonth);
      if (dErr) return res.status(500).json({ error: dErr.message });

      // Sum delta per user, use their latest new_rating as the current rating.
      const agg = new Map<string, { rating: number; matches_played: number; delta: number }>();
      for (const row of deltas || []) {
        const existing = agg.get(row.user_id) ?? { rating: row.new_rating ?? 0, matches_played: 0, delta: 0 };
        existing.rating = row.new_rating ?? existing.rating;
        existing.matches_played += 1;
        existing.delta += row.delta ?? 0;
        agg.set(row.user_id, existing);
      }

      profiles = Array.from(agg.entries())
        .map(([user_id, v]) => ({
          user_id,
          rating: Math.round(v.rating + v.delta * 0), // rating is latest
          matches_played: v.matches_played,
          wins: 0, // wins/losses not tracked in rating_history
        }))
        .sort((a, b) => b.rating - a.rating);
    } else {
      let query = supabase
        .from('user_sport_profiles')
        .select('user_id, rating, matches_played, wins')
        .eq('sport_id', sport_id)
        .gt('matches_played', 0)
        .order('rating', { ascending: false });
      // Filter by gender category if specified (men/women/open)
      if (genderCategory) query = query.eq('gender_category', genderCategory);
      const { data: rows, error } = await query;
      if (error) return res.status(500).json({ error: error.message });
      profiles = (rows ?? []) as Row[];
    }

    if (profiles.length === 0) {
      return res.json({ leaderboard: [], me: null });
    }

    // Fetch user details for ranked profiles (we fetch all so we can filter by
    // city in JS — user pool isn't huge).
    const userIds = profiles.map((p) => p.user_id);
    const { data: users } = await supabase
      .from('users')
      .select('id, name, username, profile_picture_url, city_id, is_premium')
      .in('id', userIds);

    const userMap = new Map<string, any>();
    for (const u of users || []) userMap.set(u.id, u);

    // Filter by city scope if requested.
    const filtered = scope === 'city' && myCityId
      ? profiles.filter((p) => userMap.get(p.user_id)?.city_id === myCityId)
      : profiles;

    const topN = filtered.slice(0, pageSize);
    const leaderboard = topN.map((p, i) => {
      const u = userMap.get(p.user_id);
      return {
        rank: i + 1,
        user_id: p.user_id,
        name: u?.name ?? 'Player',
        username: u?.username ?? null,
        profile_picture_url: u?.profile_picture_url ?? null,
        city_id: u?.city_id ?? null,
        is_premium: !!u?.is_premium,
        rating: p.rating,
        matches_played: p.matches_played,
        wins: p.wins,
      };
    });

    // Also surface the requester's own rank so the screen can highlight them
    // even when they're outside the page. Uses the full filtered list.
    const myIndex = filtered.findIndex((p) => p.user_id === userId);
    const meRow = myIndex >= 0
      ? {
          rank: myIndex + 1,
          user_id: userId,
          rating: filtered[myIndex].rating,
          matches_played: filtered[myIndex].matches_played,
          wins: filtered[myIndex].wins,
        }
      : null;

    return res.json({ leaderboard, me: meRow });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
