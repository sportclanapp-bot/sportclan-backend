import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

/**
 * Admin controller · stats + moderation + broadcast.
 *
 * All routes assume `requireAdmin` middleware has already run, so we
 * trust req.userId to be an admin. Failures here return 5xx; missing
 * tables return zeros rather than crashing the dashboard.
 */

// GET /admin/stats
export async function getStats(_req: Request, res: Response) {
  try {
    const oneWeekAgoIso = new Date(Date.now() - 7 * 86400000).toISOString();

    // Run all counts in parallel; tolerate individual failures.
    const [users, premium, posts, matches, tournaments, reports] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }).then((r) => r.count ?? 0).catch(() => 0),
      supabase
        .from('subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .then((r) => r.count ?? 0)
        .catch(() => 0),
      supabase
        .from('community_posts')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', oneWeekAgoIso)
        .then((r) => r.count ?? 0)
        .catch(() => 0),
      supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', oneWeekAgoIso)
        .then((r) => r.count ?? 0)
        .catch(() => 0),
      supabase
        .from('tournaments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'live')
        .then((r) => r.count ?? 0)
        .catch(() => 0),
      supabase
        .from('content_reports')
        .select('id', { count: 'exact', head: true })
        .eq('resolved', false)
        .then((r) => r.count ?? 0)
        .catch(() => 0),
    ]);

    return res.json({
      user_count: users,
      premium_count: premium,
      posts_this_week: posts,
      matches_this_week: matches,
      active_tournaments: tournaments,
      open_reports: reports,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to load stats' });
  }
}

// GET /admin/reports
export async function getReports(_req: Request, res: Response) {
  try {
    const { data, error } = await supabase
      .from('content_reports')
      .select('id, target_type, target_id, reason, reporter_id, resolved, created_at')
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      // Table may not exist yet
      return res.json({ reports: [] });
    }
    return res.json({ reports: data ?? [] });
  } catch {
    return res.json({ reports: [] });
  }
}

// PATCH /admin/reports/:id
export async function resolveReport(req: Request, res: Response) {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('content_reports')
      .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: req.userId })
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed' });
  }
}

// POST /admin/broadcast
// Body: { title, body }
// Inserts one notification row per active user. For now this is a simple
// fan-out; a future version should batch + use a queue.
export async function broadcastAnnouncement(req: Request, res: Response) {
  const { title, body } = req.body || {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'title is required' });
  }
  if (!body || typeof body !== 'string') {
    return res.status(400).json({ error: 'body is required' });
  }

  try {
    // Fetch active users (last 30 days)
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id')
      .gte('last_active_at', cutoff);
    if (usersErr) return res.status(500).json({ error: usersErr.message });

    const rows = (users ?? []).map((u: { id: string }) => ({
      user_id: u.id,
      type: 'system',
      title,
      body,
      data: { broadcast: true },
    }));

    if (rows.length === 0) {
      return res.json({ ok: true, recipients: 0 });
    }

    // Bulk insert in chunks of 500 to stay within Supabase limits
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error: insertErr } = await supabase.from('notifications').insert(chunk);
      if (insertErr) {
        return res.status(500).json({ error: insertErr.message, recipients: i });
      }
    }

    return res.json({ ok: true, recipients: rows.length });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Broadcast failed' });
  }
}
