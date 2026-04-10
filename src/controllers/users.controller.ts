import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

// Public-safe user fields. Never returns password_hash.
const PUBLIC_FIELDS =
  'id, phone, name, email, city_id, account_type, profile_picture_url, bio, is_premium, premium_expires_at, coin_balance, created_at';

// GET /users/:id — public profile
export async function getUserById(req: Request, res: Response) {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('users')
    .select(PUBLIC_FIELDS)
    .eq('id', id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'User not found' });

  // Counts (followers/following) — best-effort, never fail the request.
  const [followersRes, followingRes] = await Promise.all([
    supabase.from('follow_relationships').select('id', { count: 'exact', head: true }).eq('following_id', id),
    supabase.from('follow_relationships').select('id', { count: 'exact', head: true }).eq('follower_id', id),
  ]);

  return res.json({
    user: data,
    followers: followersRes.count ?? 0,
    following: followingRes.count ?? 0,
  });
}

// PATCH /users/me — update own profile.
// Change #4: NO size limit on profile_picture_url. We accept any URL.
const ALLOWED_FIELDS = [
  'name', 'username', 'email', 'city_id', 'profile_picture_url', 'bio',
  'link', 'gender', 'dob',
] as const;

const USERNAME_COOLDOWN_DAYS = 30;

export async function updateMe(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const patch: Record<string, unknown> = {};
  for (const k of ALLOWED_FIELDS) {
    if (k in (req.body || {})) patch[k] = req.body[k];
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  // Username change: enforce 30-day cooldown and uniqueness
  if ('username' in patch && patch.username) {
    const { data: current } = await supabase
      .from('users')
      .select('username, last_username_changed_at')
      .eq('id', userId)
      .single();

    if (current && (patch.username as string).toLowerCase() !== current.username?.toLowerCase()) {
      // Check cooldown
      if (current.last_username_changed_at) {
        const lastChanged = new Date(current.last_username_changed_at);
        const nextAllowed = new Date(lastChanged.getTime() + USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
        if (new Date() < nextAllowed) {
          return res.status(400).json({
            error: `Username can only be changed once every 30 days. Next change available: ${nextAllowed.toISOString().split('T')[0]}`,
          });
        }
      }
      // Check uniqueness
      const { data: taken } = await supabase
        .from('users')
        .select('id')
        .ilike('username', patch.username as string)
        .neq('id', userId)
        .maybeSingle();
      if (taken) return res.status(409).json({ error: 'Username already taken' });

      patch.last_username_changed_at = new Date().toISOString();
    } else {
      // Same username — remove from patch
      delete patch.username;
    }
  }

  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', userId)
    .select(PUBLIC_FIELDS)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ user: data });
}

// POST /users/:id/follow
export async function followUser(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id: target } = req.params;
  if (target === userId) return res.status(400).json({ error: 'Cannot follow yourself' });
  const { error } = await supabase
    .from('follow_relationships')
    .insert({ follower_id: userId, following_id: target });
  if (error && !error.message.includes('duplicate')) {
    return res.status(500).json({ error: error.message });
  }
  return res.json({ success: true });
}

// DELETE /users/:id/follow
export async function unfollowUser(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id: target } = req.params;
  const { error } = await supabase
    .from('follow_relationships')
    .delete()
    .eq('follower_id', userId)
    .eq('following_id', target);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
}

// GET /users/:id/followers
export async function getFollowers(req: Request, res: Response) {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('follow_relationships')
    .select('follower_id, users:follower_id (id, name, profile_picture_url, bio)')
    .eq('following_id', id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ users: (data || []).map((r: any) => r.users).filter(Boolean) });
}

// GET /users/:id/following
export async function getFollowing(req: Request, res: Response) {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('follow_relationships')
    .select('following_id, users:following_id (id, name, profile_picture_url, bio)')
    .eq('follower_id', id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ users: (data || []).map((r: any) => r.users).filter(Boolean) });
}

// POST /users/:id/block
export async function blockUser(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id: target } = req.params;
  if (target === userId) return res.status(400).json({ error: 'Cannot block yourself' });

  // Blocking implicitly unfollows in both directions.
  await supabase
    .from('follow_relationships')
    .delete()
    .or(`and(follower_id.eq.${userId},following_id.eq.${target}),and(follower_id.eq.${target},following_id.eq.${userId})`);

  const { error } = await supabase
    .from('user_blocks')
    .insert({ blocker_id: userId, blocked_id: target });
  if (error && !error.message.includes('duplicate')) {
    return res.status(500).json({ error: error.message });
  }
  return res.json({ success: true });
}

// DELETE /users/:id/block
export async function unblockUser(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id: target } = req.params;
  const { error } = await supabase
    .from('user_blocks')
    .delete()
    .eq('blocker_id', userId)
    .eq('blocked_id', target);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
}

// GET /users/me/blocked
export async function getBlockedUsers(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { data, error } = await supabase
    .from('user_blocks')
    .select('blocked_id, users:blocked_id (id, name, profile_picture_url)')
    .eq('blocker_id', userId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ users: (data || []).map((r: any) => r.users).filter(Boolean) });
}

// GET /users/me/profile-completeness
// Simple % score based on filled-in fields. Tweak weights freely.
export async function getProfileCompleteness(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { data: user, error } = await supabase
    .from('users')
    .select('name, email, city_id, profile_picture_url, bio')
    .eq('id', userId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const checks: Array<{ field: string; filled: boolean; weight: number }> = [
    { field: 'name', filled: !!user.name, weight: 20 },
    { field: 'email', filled: !!user.email, weight: 15 },
    { field: 'city_id', filled: !!user.city_id, weight: 15 },
    { field: 'profile_picture_url', filled: !!user.profile_picture_url, weight: 25 },
    { field: 'bio', filled: !!user.bio, weight: 10 },
  ];
  // Sport count contributes the remaining 15 points.
  const { count: sportCountRaw } = await supabase
    .from('user_sports')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  const sportCount = sportCountRaw ?? 0;
  const sportPoints = Math.min(15, sportCount * 5);

  const filledPoints = checks.reduce((sum, c) => sum + (c.filled ? c.weight : 0), 0);
  const percent = Math.min(100, filledPoints + sportPoints);

  const missing = checks.filter((c) => !c.filled).map((c) => c.field);
  if (sportCount === 0) missing.push('sports');

  return res.json({ percent, missing });
}

// GET /users/discover?sport_id=&mode=singles|doubles
// Returns players within ±15% rating, same city, not blocked, sorted by last_active.
export async function discoverPlayers(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { sport_id, mode } = req.query as Record<string, string | undefined>;
  if (!sport_id) return res.status(400).json({ error: 'sport_id is required' });

  // Get requesting user's city and sport profile
  const { data: me } = await supabase
    .from('users')
    .select('city_id')
    .eq('id', userId)
    .maybeSingle();
  if (!me) return res.status(404).json({ error: 'User not found' });

  const { data: myProfile } = await supabase
    .from('user_sport_profiles')
    .select('rating')
    .eq('user_id', userId)
    .eq('sport_id', sport_id)
    .maybeSingle();

  const myRating = myProfile?.rating ?? 1200;
  const ratingLow = myRating * 0.85;
  const ratingHigh = myRating * 1.15;

  // Get blocked user IDs (in both directions)
  const { data: blocksOut } = await supabase
    .from('user_blocks')
    .select('blocked_id')
    .eq('blocker_id', userId);
  const { data: blocksIn } = await supabase
    .from('user_blocks')
    .select('blocker_id')
    .eq('blocked_id', userId);

  const blockedIds = new Set<string>();
  blockedIds.add(userId);
  for (const b of blocksOut || []) blockedIds.add(b.blocked_id);
  for (const b of blocksIn || []) blockedIds.add(b.blocker_id);

  // Query user_sport_profiles within rating range for this sport
  let query = supabase
    .from('user_sport_profiles')
    .select('user_id, rating, matches_played, wins, last_match_at')
    .eq('sport_id', sport_id)
    .gte('rating', ratingLow)
    .lte('rating', ratingHigh)
    .order('last_match_at', { ascending: false, nullsFirst: false })
    .limit(50);

  const { data: profiles, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Filter out blocked users
  const filteredProfiles = (profiles || []).filter((p) => !blockedIds.has(p.user_id));
  if (filteredProfiles.length === 0) return res.json({ players: [] });

  // Fetch user details for matched profiles
  const matchedIds = filteredProfiles.map((p) => p.user_id);
  const { data: users } = await supabase
    .from('users')
    .select('id, name, username, profile_picture_url, city_id, is_premium')
    .in('id', matchedIds);

  const userMap = new Map<string, any>();
  for (const u of users || []) userMap.set(u.id, u);

  // Filter by same city if user has one
  const players = filteredProfiles
    .map((p) => {
      const u = userMap.get(p.user_id);
      if (!u) return null;
      if (me.city_id && u.city_id && u.city_id !== me.city_id) return null;
      return {
        user_id: p.user_id,
        name: u.name,
        username: u.username,
        profile_picture_url: u.profile_picture_url,
        city_id: u.city_id,
        is_premium: u.is_premium,
        rating: p.rating,
        matches_played: p.matches_played,
        wins: p.wins,
        last_active: p.last_match_at,
      };
    })
    .filter(Boolean);

  return res.json({ players, mode: mode || 'singles' });
}

// GET /users/:id/sport-profile/:sportId — per-sport rating + stats
export async function getSportProfile(req: Request, res: Response) {
  const { id, sportId } = req.params;

  const { data: profile } = await supabase
    .from('user_sport_profiles')
    .select('rating, matches_played, wins, losses, draws, last_match_at')
    .eq('user_id', id)
    .eq('sport_id', sportId)
    .maybeSingle();

  if (!profile) {
    return res.json({
      profile: {
        rating: 1200,
        matches_played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        last_match_at: null,
      },
    });
  }

  return res.json({ profile });
}
