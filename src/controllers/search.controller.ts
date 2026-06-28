import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

// ─── UNIFIED SEARCH ─────────────────────────────────────────────────────────
export async function search(req: Request, res: Response) {
  const { q, tab, sport_id, limit = '20' } = req.query;
  const pageSize = Math.min(parseInt(limit as string, 10) || 20, 50);

  if (!q || (q as string).trim().length === 0) {
    return res.json({ data: [] });
  }

  const query = (q as string).trim();
  const activeTab = (tab as string) || 'players';

  switch (activeTab) {
    case 'players':
      return searchPlayers(res, query, sport_id as string, pageSize);
    case 'teams':
      return searchTeams(res, query, sport_id as string, pageSize);
    case 'tournaments':
      return searchTournaments(res, query, sport_id as string, pageSize);
    case 'umpires':
      return searchUmpires(res, query, sport_id as string, pageSize);
    case 'coaches':
      return searchByAccountType(res, query, 'coach', pageSize);
    case 'posts':
      return searchPosts(res, query, sport_id as string, pageSize);
    case 'businesses':
      return searchBusinesses(res, query, pageSize);
    case 'associations':
      return searchByAccountType(res, query, 'association', pageSize);
    case 'clubs':
      return searchClubs(res, query, pageSize);
    default:
      return res.status(400).json({ error: 'Invalid tab' });
  }
}

async function searchPlayers(res: Response, q: string, sportId: string | undefined, limit: number) {
  const { data, error } = await supabase
    .from('users')
    .select(`
      id, name, username, profile_picture_url, is_premium,
      city:cities!city_id(id, name),
      sports:user_sports(sport:sports(id, name, emoji))
    `)
    .or(`username.ilike.%${q}%,name.ilike.%${q}%`)
    // Premium users appear first — delivers the "Boosted ranking" promise
    .order('is_premium', { ascending: false })
    .order('name', { ascending: true })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data: data || [] });
}

async function searchTeams(res: Response, q: string, sportId: string | undefined, limit: number) {
  let query = supabase
    .from('teams')
    .select(`
      id, name, logo_url, sport_id,
      sport:sports!sport_id(id, name, emoji),
      city:cities!city_id(id, name)
    `)
    .ilike('name', `%${q}%`)
    .limit(limit);

  if (sportId) query = query.eq('sport_id', sportId);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data: data || [] });
}

async function searchTournaments(res: Response, q: string, sportId: string | undefined, limit: number) {
  let query = supabase
    .from('tournaments')
    .select(`
      id, name, banner_url, sport_id, status, start_date, end_date,
      sport:sports!sport_id(id, name, emoji),
      city:cities!city_id(id, name)
    `)
    .ilike('name', `%${q}%`)
    .order('start_date', { ascending: false })
    .limit(limit);

  if (sportId) query = query.eq('sport_id', sportId);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data: data || [] });
}

async function searchUmpires(res: Response, q: string, sportId: string | undefined, limit: number) {
  // Only premium umpires shown
  const { data, error } = await supabase
    .from('users')
    .select(`
      id, name, username, profile_picture_url, is_premium,
      city:cities!city_id(id, name)
    `)
    .eq('is_premium', true)
    .or(`username.ilike.%${q}%,name.ilike.%${q}%`)
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });

  // Filter to only umpire/referee account types
  const userIds = (data || []).map((u) => u.id);
  if (userIds.length === 0) return res.json({ data: [] });

  const { data: accountTypes } = await supabase
    .from('user_account_types')
    .select('user_id, account_type')
    .in('user_id', userIds)
    .in('account_type', ['umpire', 'referee']);

  const umpireIds = new Set((accountTypes || []).map((a) => a.user_id));
  const filtered = (data || []).filter((u) => umpireIds.has(u.id));

  return res.json({ data: filtered });
}

async function searchPosts(res: Response, q: string, sportId: string | undefined, limit: number) {
  let query = supabase
    .from('community_posts')
    .select(`
      id, content, created_at, likes_count, comments_count,
      author:users!author_id(id, name, username, profile_picture_url),
      sport:sports!sport_id(id, name, emoji)
    `)
    .ilike('content', `%${q}%`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (sportId) query = query.eq('sport_id', sportId);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data: data || [] });
}

async function searchBusinesses(res: Response, q: string, limit: number) {
  // Businesses are Premium users with Business account type
  const { data: users, error } = await supabase
    .from('users')
    .select(`
      id, name, username, profile_picture_url, is_premium,
      city:cities!city_id(id, name)
    `)
    .eq('is_premium', true)
    .or(`username.ilike.%${q}%,name.ilike.%${q}%`)
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });

  const userIds = (users || []).map((u) => u.id);
  if (userIds.length === 0) return res.json({ data: [] });

  const { data: accountTypes } = await supabase
    .from('user_account_types')
    .select('user_id, account_type')
    .in('user_id', userIds)
    .eq('account_type', 'business');

  const bizIds = new Set((accountTypes || []).map((a) => a.user_id));
  const filtered = (users || []).filter((u) => bizIds.has(u.id));

  return res.json({ data: filtered });
}

// Generic account-type search — used for Coaches, Associations, etc.
async function searchByAccountType(res: Response, q: string, accountType: string, limit: number) {
  let query = supabase
    .from('users')
    .select('id, name, username, profile_picture_url, bio, is_premium, account_type, city:cities!city_id(id, name)')
    .ilike('account_type', `%${accountType}%`)
    // Premium service accounts appear first — "Featured listing"
    .order('is_premium', { ascending: false })
    .order('name', { ascending: true })
    .limit(limit);
  if (q) query = query.ilike('name', `%${q}%`);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data: data || [] });
}

async function searchClubs(res: Response, q: string, limit: number) {
  // Clubs/associations use teams table with type = 'club' or 'association'
  // For now, search teams with larger member counts as proxy
  const { data, error } = await supabase
    .from('teams')
    .select(`
      id, name, logo_url,
      sport:sports!sport_id(id, name, emoji),
      city:cities!city_id(id, name)
    `)
    .ilike('name', `%${q}%`)
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data: data || [] });
}
