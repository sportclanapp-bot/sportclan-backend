import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

// GET /leaderboard?sport_id=&limit=20
// Returns top players by ELO rating from user_sport_profiles.
export async function getLeaderboard(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { sport_id, limit = '20' } = req.query as Record<string, string | undefined>;
    if (!sport_id) return res.status(400).json({ error: 'sport_id is required' });

    const pageSize = Math.min(parseInt(limit, 10) || 20, 50);

    const { data: profiles, error } = await supabase
      .from('user_sport_profiles')
      .select('user_id, rating, matches_played, wins')
      .eq('sport_id', sport_id)
      .gt('matches_played', 0)
      .order('rating', { ascending: false })
      .limit(pageSize);

    if (error) return res.status(500).json({ error: error.message });
    if (!profiles || profiles.length === 0) {
      return res.json({ leaderboard: [] });
    }

    // Fetch user details for ranked profiles
    const userIds = profiles.map((p) => p.user_id);
    const { data: users } = await supabase
      .from('users')
      .select('id, name, username, profile_picture_url, city_id')
      .in('id', userIds);

    const userMap = new Map<string, any>();
    for (const u of users || []) userMap.set(u.id, u);

    const leaderboard = profiles.map((p, i) => {
      const u = userMap.get(p.user_id);
      return {
        rank: i + 1,
        user_id: p.user_id,
        name: u?.name ?? 'Player',
        username: u?.username ?? null,
        profile_picture_url: u?.profile_picture_url ?? null,
        city_id: u?.city_id ?? null,
        rating: p.rating,
        matches_played: p.matches_played,
        wins: p.wins,
      };
    });

    return res.json({ leaderboard });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
