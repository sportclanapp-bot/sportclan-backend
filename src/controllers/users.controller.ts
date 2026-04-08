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
const ALLOWED_FIELDS = ['name', 'email', 'city_id', 'profile_picture_url', 'bio'] as const;

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
