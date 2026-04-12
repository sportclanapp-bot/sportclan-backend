"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.search = void 0;
const supabase_1 = require("../utils/supabase");
// ─── UNIFIED SEARCH ─────────────────────────────────────────────────────────
async function search(req, res) {
    const { q, tab, sport_id, limit = '20' } = req.query;
    const pageSize = Math.min(parseInt(limit, 10) || 20, 50);
    if (!q || q.trim().length === 0) {
        return res.json({ data: [] });
    }
    const query = q.trim();
    const activeTab = tab || 'players';
    switch (activeTab) {
        case 'players':
            return searchPlayers(res, query, sport_id, pageSize);
        case 'teams':
            return searchTeams(res, query, sport_id, pageSize);
        case 'tournaments':
            return searchTournaments(res, query, sport_id, pageSize);
        case 'umpires':
            return searchUmpires(res, query, sport_id, pageSize);
        case 'coaches':
            return searchByAccountType(res, query, 'Trainer-Coach', pageSize);
        case 'posts':
            return searchPosts(res, query, sport_id, pageSize);
        case 'businesses':
            return searchBusinesses(res, query, pageSize);
        case 'associations':
            return searchByAccountType(res, query, 'Association', pageSize);
        case 'clubs':
            return searchClubs(res, query, pageSize);
        default:
            return res.status(400).json({ error: 'Invalid tab' });
    }
}
exports.search = search;
async function searchPlayers(res, q, sportId, limit) {
    const { data, error } = await supabase_1.supabase
        .from('users')
        .select(`
      id, full_name, username, profile_picture_url, is_premium,
      city:cities!city_id(id, name),
      sports:user_sports(sport:sports(id, name, emoji))
    `)
        .or(`username.ilike.%${q}%,full_name.ilike.%${q}%`)
        // Premium users appear first — delivers the "Boosted ranking" promise
        .order('is_premium', { ascending: false })
        .order('full_name', { ascending: true })
        .limit(limit);
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ data: data || [] });
}
async function searchTeams(res, q, sportId, limit) {
    let query = supabase_1.supabase
        .from('teams')
        .select(`
      id, name, logo_url, sport_id,
      sport:sports!sport_id(id, name, emoji),
      city:cities!city_id(id, name)
    `)
        .ilike('name', `%${q}%`)
        .limit(limit);
    if (sportId)
        query = query.eq('sport_id', sportId);
    const { data, error } = await query;
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ data: data || [] });
}
async function searchTournaments(res, q, sportId, limit) {
    let query = supabase_1.supabase
        .from('tournaments')
        .select(`
      id, name, banner_url, sport_id, status, start_date, end_date,
      sport:sports!sport_id(id, name, emoji),
      city:cities!city_id(id, name)
    `)
        .ilike('name', `%${q}%`)
        .order('start_date', { ascending: false })
        .limit(limit);
    if (sportId)
        query = query.eq('sport_id', sportId);
    const { data, error } = await query;
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ data: data || [] });
}
async function searchUmpires(res, q, sportId, limit) {
    // Only premium umpires shown
    const { data, error } = await supabase_1.supabase
        .from('users')
        .select(`
      id, full_name, username, profile_picture_url, is_premium,
      city:cities!city_id(id, name)
    `)
        .eq('is_premium', true)
        .or(`username.ilike.%${q}%,full_name.ilike.%${q}%`)
        .limit(limit);
    if (error)
        return res.status(500).json({ error: error.message });
    // Filter to only umpire/referee account types
    const userIds = (data || []).map((u) => u.id);
    if (userIds.length === 0)
        return res.json({ data: [] });
    const { data: accountTypes } = await supabase_1.supabase
        .from('user_account_types')
        .select('user_id, account_type')
        .in('user_id', userIds)
        .in('account_type', ['Umpire', 'Referee']);
    const umpireIds = new Set((accountTypes || []).map((a) => a.user_id));
    const filtered = (data || []).filter((u) => umpireIds.has(u.id));
    return res.json({ data: filtered });
}
async function searchPosts(res, q, sportId, limit) {
    let query = supabase_1.supabase
        .from('community_posts')
        .select(`
      id, content, created_at, likes_count, comments_count,
      author:users!author_id(id, full_name, username, profile_picture_url),
      sport:sports!sport_id(id, name, emoji)
    `)
        .ilike('content', `%${q}%`)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (sportId)
        query = query.eq('sport_id', sportId);
    const { data, error } = await query;
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ data: data || [] });
}
async function searchBusinesses(res, q, limit) {
    // Businesses are Premium users with Business account type
    const { data: users, error } = await supabase_1.supabase
        .from('users')
        .select(`
      id, full_name, username, profile_picture_url, is_premium,
      city:cities!city_id(id, name)
    `)
        .eq('is_premium', true)
        .or(`username.ilike.%${q}%,full_name.ilike.%${q}%`)
        .limit(limit);
    if (error)
        return res.status(500).json({ error: error.message });
    const userIds = (users || []).map((u) => u.id);
    if (userIds.length === 0)
        return res.json({ data: [] });
    const { data: accountTypes } = await supabase_1.supabase
        .from('user_account_types')
        .select('user_id, account_type')
        .in('user_id', userIds)
        .eq('account_type', 'Business');
    const bizIds = new Set((accountTypes || []).map((a) => a.user_id));
    const filtered = (users || []).filter((u) => bizIds.has(u.id));
    return res.json({ data: filtered });
}
// Generic account-type search — used for Coaches, Associations, etc.
async function searchByAccountType(res, q, accountType, limit) {
    let query = supabase_1.supabase
        .from('users')
        .select('id, name, username, profile_picture_url, bio, is_premium, account_type, city:cities!city_id(id, name)')
        .ilike('account_type', `%${accountType}%`)
        // Premium service accounts appear first — "Featured listing"
        .order('is_premium', { ascending: false })
        .order('name', { ascending: true })
        .limit(limit);
    if (q)
        query = query.ilike('name', `%${q}%`);
    const { data, error } = await query;
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ data: data || [] });
}
async function searchClubs(res, q, limit) {
    // Clubs/associations use teams table with type = 'club' or 'association'
    // For now, search teams with larger member counts as proxy
    const { data, error } = await supabase_1.supabase
        .from('teams')
        .select(`
      id, name, logo_url,
      sport:sports!sport_id(id, name, emoji),
      city:cities!city_id(id, name)
    `)
        .ilike('name', `%${q}%`)
        .limit(limit);
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ data: data || [] });
}
//# sourceMappingURL=search.controller.js.map