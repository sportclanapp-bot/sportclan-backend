import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { resolveSportId } from '../utils/sportId';
import { parsePagination, pageMeta } from '../utils/pagination';

// GET /leaderboard
// Query:
//   sport_id   (required) — UUID or slug ('cricket'); unknown → 400 (SC-6).
//   scope      = 'global' (default) | 'city'
//   period     = 'alltime' (default) | 'monthly' — monthly only counts matches
//                in the current calendar month.
//   limit      — page size (1-50, default 20)
//   offset     — rows to skip (default 0)
//
// For 'alltime' we rank pre-aggregated ELO from user_sport_profiles ENTIRELY in
// the database (order + range), so we only ever pull the requested page — then
// fetch display names for JUST that page. Previously this fetched every ranked
// profile and did `.in('id', <all user_ids>)`; at scale (130k profiles) that
// `.in()` blew past PostgREST's limits, returned no users, and every row fell
// back to name "Player" / null username (SC-4/SC-10).

const USER_FIELDS = 'id, name, username, profile_picture_url, city_id, is_premium';

type Row = { user_id: string; rating: number; matches_played: number; wins: number };

async function fetchUserMap(ids: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (ids.length === 0) return map;
  const { data } = await supabase.from('users').select(USER_FIELDS).in('id', ids);
  for (const u of data || []) map.set(u.id, u);
  return map;
}

function toEntry(p: Row, rank: number, u: any) {
  return {
    rank,
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
}

// Stable competition tie-break: rating desc, then wins desc, then
// matches_played desc, then user_id asc (SC-5). Used for the in-JS monthly path
// and mirrored by the .order() chain on the DB alltime path.
function compareRows(a: Row, b: Row): number {
  return (
    b.rating - a.rating ||
    b.wins - a.wins ||
    b.matches_played - a.matches_played ||
    (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0)
  );
}

export async function getLeaderboard(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const scope = ((req.query.scope as string) || 'global').toLowerCase();
    const period = ((req.query.period as string) || 'alltime').toLowerCase();
    const genderCategory = (req.query.gender_category as string | undefined) || null;

    const rawSport = req.query.sport_id as string | undefined;
    if (!rawSport) return res.status(400).json({ error: 'sport_id is required' });
    // Resolve UUID-or-slug up front; an unknown sport is a client error (400),
    // not a Postgres "invalid uuid" 500 (SC-6).
    const sportId = await resolveSportId(rawSport);
    if (!sportId) return res.status(400).json({ error: 'Unknown sport_id' });

    const p = parsePagination(req.query as Record<string, unknown>, { defaultLimit: 20, maxLimit: 50 });

    // City scope: restrict to the requester's city by first resolving the set of
    // user_ids in that city, then filtering profiles by membership. Bounded by
    // one city's population — never the whole user base.
    let cityUserIds: string[] | null = null;
    if (scope === 'city') {
      const { data: me } = await supabase.from('users').select('city_id').eq('id', userId).maybeSingle();
      const myCityId = me?.city_id ?? null;
      if (!myCityId) return res.json({ leaderboard: [], me: null, ...pageMeta(0, p) });
      const { data: cityUsers } = await supabase.from('users').select('id').eq('city_id', myCityId);
      cityUserIds = (cityUsers || []).map((u: any) => u.id);
      if (cityUserIds.length === 0) return res.json({ leaderboard: [], me: null, ...pageMeta(0, p) });
    }

    // ---- MONTHLY: rank by current-month rating delta (kept in JS; the
    // rating_history month window is small relative to all-time profiles). ----
    if (period === 'monthly') {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const { data: deltas, error: dErr } = await supabase
        .from('rating_history')
        .select('user_id, delta, new_rating')
        .eq('sport_id', sportId)
        .gte('created_at', startOfMonth);
      if (dErr) return res.status(500).json({ error: dErr.message });

      const agg = new Map<string, Row>();
      for (const row of deltas || []) {
        const existing = agg.get(row.user_id) ?? { user_id: row.user_id, rating: row.new_rating ?? 0, matches_played: 0, wins: 0 };
        existing.rating = row.new_rating ?? existing.rating;
        existing.matches_played += 1;
        agg.set(row.user_id, existing);
      }
      let ranked = Array.from(agg.values());
      if (cityUserIds) {
        const set = new Set(cityUserIds);
        ranked = ranked.filter((r) => set.has(r.user_id));
      }
      ranked.sort(compareRows);

      const total = ranked.length;
      const pageRows = ranked.slice(p.offset, p.offset + p.limit);
      const userMap = await fetchUserMap(pageRows.map((r) => r.user_id));
      const leaderboard = pageRows.map((r, i) => toEntry(r, p.offset + i + 1, userMap.get(r.user_id)));

      const myIndex = ranked.findIndex((r) => r.user_id === userId);
      const me = myIndex >= 0
        ? { rank: myIndex + 1, user_id: userId, rating: ranked[myIndex].rating, matches_played: ranked[myIndex].matches_played, wins: ranked[myIndex].wins }
        : null;
      return res.json({ leaderboard, me, ...pageMeta(total, p) });
    }

    // ---- ALL-TIME: rank + page in the database, fetch names for the page only. ----
    const scoped = <T>(q: T): T => {
      let qb: any = (q as any).eq('sport_id', sportId).gt('matches_played', 0);
      if (genderCategory) qb = qb.eq('gender_category', genderCategory);
      if (cityUserIds) qb = qb.in('user_id', cityUserIds);
      return qb as T;
    };

    // Total count (head-only; the same exact-count pattern the admin tiles use).
    const { count: total } = await scoped(
      supabase.from('user_sport_profiles').select('user_id', { count: 'exact', head: true }),
    );

    // The page itself, tie-broken in the DB (SC-5).
    const { data: rows, error } = await scoped(
      supabase.from('user_sport_profiles').select('user_id, rating, matches_played, wins'),
    )
      .order('rating', { ascending: false })
      .order('wins', { ascending: false })
      .order('matches_played', { ascending: false })
      .order('user_id', { ascending: true })
      .range(p.from, p.to);
    if (error) return res.status(500).json({ error: error.message });

    const pageRows = (rows || []) as Row[];
    const userMap = await fetchUserMap(pageRows.map((r) => r.user_id));
    const leaderboard = pageRows.map((r, i) => toEntry(r, p.offset + i + 1, userMap.get(r.user_id)));

    // Requester's own rank — competition rank by rating (count of stronger
    // profiles + 1), computed with a single cheap head-count. No full scan.
    let me: any = null;
    const { data: myProf } = await scoped(
      supabase.from('user_sport_profiles').select('rating, matches_played, wins'),
    )
      .eq('user_id', userId)
      .maybeSingle();
    if (myProf) {
      const { count: above } = await scoped(
        supabase.from('user_sport_profiles').select('user_id', { count: 'exact', head: true }),
      ).gt('rating', myProf.rating);
      me = {
        rank: (above ?? 0) + 1,
        user_id: userId,
        rating: myProf.rating,
        matches_played: myProf.matches_played,
        wins: myProf.wins,
      };
    }

    return res.json({ leaderboard, me, ...pageMeta(total, p) });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
