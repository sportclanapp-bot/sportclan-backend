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
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) return res.status(500).json({ error: error.message });
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
