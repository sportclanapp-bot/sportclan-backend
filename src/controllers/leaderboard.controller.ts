// Leaderboard controller — STUB IMPLEMENTATION
//
// Real aggregation (counts of matches/wins/points per user, joined to
// match_participants and matches where status='completed', then ranked
// by city/state/national scope) is deferred. For now we attempt a simple
// completed-match participation count and fall back to a stub array.
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

export async function getLeaderboard(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { sport_id, scope, city_id, metric } = req.query as Record<string, string | undefined>;
    if (!sport_id) return res.status(400).json({ error: 'sport_id is required' });
    void scope;
    void city_id;
    void metric;

    // Best-effort: fetch up to 200 completed matches for the sport, count
    // appearances per user via match_participants, return top 20.
    try {
      const { data: matches } = await supabase
        .from('matches')
        .select('id')
        .eq('sport_id', sport_id)
        .eq('status', 'completed')
        .limit(200);
      const matchIds = (matches || []).map((m: any) => m.id);
      if (matchIds.length > 0) {
        const { data: parts } = await supabase
          .from('match_participants')
          .select('user_id')
          .in('match_id', matchIds);
        const counts = new Map<string, number>();
        for (const p of parts || []) {
          counts.set(p.user_id, (counts.get(p.user_id) || 0) + 1);
        }
        const topIds = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
        if (topIds.length > 0) {
          const { data: users } = await supabase
            .from('users')
            .select('id, name, profile_picture_url')
            .in(
              'id',
              topIds.map(([id]) => id),
            );
          const byId = new Map((users || []).map((u: any) => [u.id, u]));
          const leaderboard = topIds.map(([id, value], i) => ({
            user_id: id,
            name: byId.get(id)?.name || 'Player',
            avatar: byId.get(id)?.profile_picture_url || null,
            value,
            rank: i + 1,
          }));
          return res.json({ leaderboard });
        }
      }
    } catch {
      // fall through to stub
    }

    // Stub fallback — empty leaderboard
    return res.json({ leaderboard: [] });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
