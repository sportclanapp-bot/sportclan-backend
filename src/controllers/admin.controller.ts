import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

/**
 * Admin controller · stats + moderation + broadcast.
 *
 * All routes assume `requireAdmin` middleware has already run, so we
 * trust req.userId to be an admin. Failures here return 5xx; missing
 * tables return zeros rather than crashing the dashboard.
 */

/**
 * Count rows for a Supabase `head:true` count query, tolerating failures
 * (missing table, network error) by returning 0. Supabase query builders are
 * PromiseLike (thenable) but not real Promises, so they have no `.catch()` —
 * we await inside try/catch instead of chaining `.then().catch()`.
 */
async function safeCount(query: PromiseLike<{ count: number | null }>): Promise<number> {
  try {
    const { count } = await query;
    return count ?? 0;
  } catch {
    return 0;
  }
}

// GET /admin/stats
export async function getStats(_req: Request, res: Response) {
  try {
    const oneWeekAgoIso = new Date(Date.now() - 7 * 86400000).toISOString();

    // Run all counts in parallel; tolerate individual failures.
    const [users, premium, posts, matches, tournaments, reports] = await Promise.all([
      safeCount(supabase.from('users').select('id', { count: 'exact', head: true })),
      safeCount(
        supabase
          .from('subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active'),
      ),
      safeCount(
        supabase
          .from('community_posts')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', oneWeekAgoIso),
      ),
      safeCount(
        supabase
          .from('matches')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', oneWeekAgoIso),
      ),
      safeCount(
        supabase
          .from('tournaments')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'live'),
      ),
      safeCount(
        supabase
          .from('content_reports')
          .select('id', { count: 'exact', head: true })
          .eq('resolved', false),
      ),
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
// Body: { action?: 'remove' | 'dismiss' }  (default 'dismiss')
//   dismiss → mark the report resolved, leave the content untouched.
//   remove  → delete the reported post/comment, then resolve this report AND
//             any sibling reports targeting the same content.
export async function resolveReport(req: Request, res: Response) {
  const { id } = req.params;
  const action = (req.body || {}).action === 'remove' ? 'remove' : 'dismiss';
  try {
    // Existence check — a missing/already-handled id is a 404, not a silent ok.
    const { data: report, error: fetchErr } = await supabase
      .from('content_reports')
      .select('id, target_type, target_id, resolved')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const now = new Date().toISOString();
    let contentRemoved = false;

    if (action === 'remove' && (report.target_type === 'post' || report.target_type === 'comment')) {
      const table = report.target_type === 'post' ? 'community_posts' : 'post_comments';
      const { error: delErr } = await supabase.from(table).delete().eq('id', report.target_id);
      if (delErr) return res.status(500).json({ error: delErr.message });
      contentRemoved = true;
    }

    // Resolve this report; if content was removed, also resolve any other
    // open reports pointing at the same target so the queue stays clean.
    const resolution = { resolved: true, resolved_at: now, resolved_by: req.userId };
    if (contentRemoved) {
      const { error: updErr } = await supabase
        .from('content_reports')
        .update(resolution)
        .eq('target_type', report.target_type)
        .eq('target_id', report.target_id)
        .eq('resolved', false);
      if (updErr) return res.status(500).json({ error: updErr.message });
    } else {
      const { error: updErr } = await supabase
        .from('content_reports')
        .update(resolution)
        .eq('id', id);
      if (updErr) return res.status(500).json({ error: updErr.message });
    }

    return res.json({ ok: true, action, contentRemoved });
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
