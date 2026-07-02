import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

// POST /notifications/token  { token, platform: 'ios'|'android'|'web' }
// Saves (or upserts) a push token for the authenticated user.
export async function savePushToken(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { token, platform } = req.body || {};
  if (!token || !platform) return res.status(400).json({ error: 'token and platform are required' });
  if (!['ios', 'android', 'web'].includes(platform)) {
    return res.status(400).json({ error: 'platform must be ios, android, or web' });
  }
  const { error } = await supabase
    .from('push_tokens')
    .upsert({ user_id: userId, token, platform }, { onConflict: 'user_id,token' });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
}

// GET /notifications  — paginated list for current user
export async function listNotifications(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 100);
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, data, read, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });

  const unreadRes = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);

  return res.json({ notifications: data || [], unread: unreadRes.count ?? 0 });
}

// PATCH /notifications/:id/read
export async function markRead(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  const { data: updated, error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');
  if (error) return res.status(500).json({ error: error.message });
  // SC-32: a 0-row update (not your notification, or missing) must 404.
  if (!updated || updated.length === 0) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  return res.json({ success: true });
}

// PATCH /notifications/read-all
export async function markAllRead(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
}

// GET /notifications/digest — computes the user's 7-day activity summary,
// inserts (at most) one `weekly_digest` row per week, and returns the stats.
// Cheap enough to run on demand — no cron required.
export async function weeklyDigest(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Matches played in the last 7 days (via participation).
  const { data: myParticipations } = await supabase
    .from('match_participants')
    .select('match_id, created_at')
    .eq('user_id', userId)
    .gte('created_at', sinceIso);
  const matches_played = myParticipations?.length ?? 0;

  // Rating delta sum from rating_history.
  const { data: deltas } = await supabase
    .from('rating_history')
    .select('delta')
    .eq('user_id', userId)
    .gte('created_at', sinceIso);
  const rating_change = (deltas || []).reduce((sum, row: any) => sum + (row.delta ?? 0), 0);

  // New followers.
  const { count: new_followers } = await supabase
    .from('follow_relationships')
    .select('id', { count: 'exact', head: true })
    .eq('following_id', userId)
    .gte('created_at', sinceIso);

  // Likes received on own posts. Two-step: find my posts, then count likes.
  const { data: myPosts } = await supabase
    .from('posts')
    .select('id')
    .eq('user_id', userId);
  const postIds = (myPosts || []).map((p) => p.id);
  let posts_liked = 0;
  if (postIds.length > 0) {
    const { count } = await supabase
      .from('post_likes')
      .select('id', { count: 'exact', head: true })
      .in('post_id', postIds)
      .gte('created_at', sinceIso);
    posts_liked = count ?? 0;
  }

  const stats = {
    matches_played,
    rating_change: Math.round(rating_change * 100) / 100,
    new_followers: new_followers ?? 0,
    posts_liked,
  };

  // Only insert one digest row per week — check if the most recent
  // weekly_digest is newer than `sinceIso`.
  const { data: recent } = await supabase
    .from('notifications')
    .select('id, created_at')
    .eq('user_id', userId)
    .eq('type', 'weekly_digest')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!recent || new Date(recent.created_at).getTime() < Date.now() - 7 * 24 * 60 * 60 * 1000) {
    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'weekly_digest',
      title: 'Your Week in Sports',
      body: `${stats.matches_played} matches \u00B7 ${stats.rating_change >= 0 ? '+' : ''}${stats.rating_change} rating \u00B7 ${stats.new_followers} new followers`,
      data: stats as any,
    });
  }

  return res.json({ stats });
}

// DELETE /notifications/:id — user can swipe-to-delete individual rows.
// Scoped to user_id so a user can only delete their own notifications.
export async function deleteNotification(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  const { data: deleted, error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');
  if (error) return res.status(500).json({ error: error.message });
  // SC-32: a 0-row delete (not your notification, or missing) must 404.
  if (!deleted || deleted.length === 0) {
    return res.status(404).json({ error: 'Notification not found' });
  }
  return res.json({ success: true });
}
