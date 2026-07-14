import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { parsePagination, pageMeta, isRangeError } from '../utils/pagination';
import { sanitizeError } from '../utils/response';
import { orIlikeContains } from '../utils/likeSearch'; // SC-237

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
// Returns open reports enriched with a preview of the reported content and the
// reporter's name, so the moderation queue can show what's being flagged
// without a round-trip per row.
export async function getReports(req: Request, res: Response) {
  const p = parsePagination(req.query as Record<string, unknown>);
  try {
    const { data: reports, error, count } = await supabase
      .from('content_reports')
      .select('id, target_type, target_id, reason, reporter_id, resolved, created_at', { count: 'exact' })
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .range(p.from, p.to);
    if (error) return res.json({ reports: [], ...pageMeta(0, p) }); // table may not exist yet
    const rows = reports ?? [];
    if (rows.length === 0) return res.json({ reports: [], ...pageMeta(count, p) });

    const postIds = [...new Set(rows.filter((r) => r.target_type === 'post').map((r) => r.target_id))];
    const commentIds = [...new Set(rows.filter((r) => r.target_type === 'comment').map((r) => r.target_id))];
    const messageIds = [...new Set(rows.filter((r) => r.target_type === 'message').map((r) => r.target_id))];
    const userTargetIds = rows.filter((r) => r.target_type === 'user').map((r) => r.target_id);

    // Fetch reported posts/comments/messages first so we can also resolve authors.
    const [postsRes, commentsRes, messagesRes] = await Promise.all([
      postIds.length
        ? supabase.from('community_posts').select('id, content, author_id').in('id', postIds)
        : Promise.resolve({ data: [] as any[] }),
      commentIds.length
        ? supabase.from('post_comments').select('id, content, author_id').in('id', commentIds)
        : Promise.resolve({ data: [] as any[] }),
      messageIds.length
        ? supabase.from('messages').select('id, content, sender_id').in('id', messageIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const posts = (postsRes.data ?? []) as Array<{ id: string; content: string; author_id: string }>;
    const comments = (commentsRes.data ?? []) as Array<{ id: string; content: string; author_id: string }>;
    const messages = (messagesRes.data ?? []) as Array<{ id: string; content: string; sender_id: string }>;

    // One batched user fetch: reporters + user-targets + content authors/senders.
    const userIds = [...new Set([
      ...rows.map((r) => r.reporter_id),
      ...userTargetIds,
      ...posts.map((p) => p.author_id),
      ...comments.map((c) => c.author_id),
      ...messages.map((m) => m.sender_id),
    ].filter(Boolean))];
    const usersRes = userIds.length
      ? await supabase.from('users').select('id, name, username').in('id', userIds)
      : { data: [] as any[] };
    const userMap = new Map((usersRes.data ?? []).map((u: any) => [u.id, u]));
    const postMap = new Map(posts.map((p) => [p.id, p]));
    const commentMap = new Map(comments.map((c) => [c.id, c]));
    const messageMap = new Map(messages.map((m) => [m.id, m]));

    const enriched = rows.map((r) => {
      const reporter = userMap.get(r.reporter_id);
      let content_preview: string | null = null;
      let content_exists = true;
      let content_author: { id: string; name: string | null } | null = null;
      if (r.target_type === 'post') {
        const p = postMap.get(r.target_id);
        content_exists = !!p;
        content_preview = p ? String(p.content).slice(0, 240) : null;
        if (p) content_author = { id: p.author_id, name: userMap.get(p.author_id)?.name ?? null };
      } else if (r.target_type === 'comment') {
        const c = commentMap.get(r.target_id);
        content_exists = !!c;
        content_preview = c ? String(c.content).slice(0, 240) : null;
        if (c) content_author = { id: c.author_id, name: userMap.get(c.author_id)?.name ?? null };
      } else if (r.target_type === 'message') {
        const m = messageMap.get(r.target_id);
        content_exists = !!m;
        content_preview = m ? String(m.content).slice(0, 240) : null;
        if (m) content_author = { id: m.sender_id, name: userMap.get(m.sender_id)?.name ?? null };
      } else if (r.target_type === 'user') {
        const u = userMap.get(r.target_id);
        content_exists = !!u;
        content_preview = u ? `@${u.username} · ${u.name}` : null;
        if (u) content_author = { id: u.id, name: u.name };
      }
      return {
        ...r,
        reporter_name: reporter?.name ?? null,
        reporter_username: reporter?.username ?? null,
        content_preview,
        content_exists,
        content_author,
      };
    });
    return res.json({ reports: enriched, ...pageMeta(count, p) });
  } catch {
    return res.json({ reports: [], ...pageMeta(0, p) });
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
  const { title, body, confirm } = req.body || {};
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

    // SC-214: a bare POST used to blast every active user (~10k) with no
    // preview or confirmation — one fat-finger = mass notification. Require an
    // explicit confirm; the un-confirmed call is a dry-run that returns the
    // exact recipient count so the caller sees the blast size before sending.
    if (confirm !== true) {
      return res.status(400).json({
        error: `This will notify ${rows.length} users. Pass confirm:true to send.`,
        recipients: rows.length,
        needsConfirm: true,
      });
    }

    // Fan-out is a per-user insert, which at scale (10k+ active users) far
    // outlasts a single HTTP request and used to time out (SC-13). Acknowledge
    // the admin immediately, then insert in the background in chunks of 500.
    // NOTE: this is a pragmatic fix, not a durable queue — if the process
    // restarts mid-fan-out some recipients are missed. A real job queue
    // (BullMQ/Redis or a Supabase edge cron) is the proper long-term solution.
    res.json({ ok: true, recipients: rows.length, queued: true });

    void (async () => {
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error: insertErr } = await supabase.from('notifications').insert(chunk);
        if (insertErr) {
          console.error(`[broadcast] insert failed at offset ${i}/${rows.length}:`, insertErr.message);
          return;
        }
      }
      console.log(`[broadcast] delivered "${title}" to ${rows.length} users`);
    })();
    return;
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Broadcast failed' });
  }
}

// Columns surfaced to the admin user-management list/detail.
const ADMIN_USER_FIELDS =
  'id, name, username, phone, email, is_premium, premium_expires_at, is_admin, suspended_at, coin_balance, created_at';

// GET /admin/users?q=&limit=
// Search users by name / username / phone (substring). No query → most recent.
export async function adminListUsers(req: Request, res: Response) {
  const q = String(req.query.q ?? '').trim();
  const p = parsePagination(req.query as Record<string, unknown>, { defaultLimit: 30, maxLimit: 100 });
  try {
    let query = supabase
      .from('users')
      .select(ADMIN_USER_FIELDS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(p.from, p.to);
    if (q) query = query.or(orIlikeContains(['name', 'username', 'phone'], q)); // SC-237: injection-safe
    const { data, error, count } = await query;
    if (error && !isRangeError(error)) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ users: data ?? [], ...pageMeta(count, p) });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to list users' });
  }
}

// PATCH /admin/users/:id
// Body (any subset): { suspended?: boolean, is_premium?: boolean, is_admin?: boolean }
//   suspended  → sets/clears suspended_at (enforced at login)
//   is_premium → toggles premium + sets/clears a 1-year premium_expires_at
//   is_admin   → toggles admin access
export async function adminUpdateUser(req: Request, res: Response) {
  const { id } = req.params;
  const { suspended, is_premium, is_admin } = req.body || {};

  // Fetch the target up front — needed to avoid clobbering a longer premium
  // expiry (ADM-003) and to enforce the last-admin guard (ADM-002).
  const { data: existing } = await supabase
    .from('users')
    .select('id, premium_expires_at, is_admin')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'User not found' });

  const patch: Record<string, unknown> = {};
  if (typeof suspended === 'boolean') {
    patch.suspended_at = suspended ? new Date().toISOString() : null;
  }
  if (typeof is_premium === 'boolean') {
    patch.is_premium = is_premium;
    if (is_premium) {
      // Grant/extend premium, but NEVER shorten an existing longer expiry. The
      // old code reset premium_expires_at to now+1y unconditionally, so
      // re-granting to an already-premium user clobbered a longer grant (ADM-003).
      const oneYear = Date.now() + 365 * 86400000;
      const current = existing.premium_expires_at ? new Date(existing.premium_expires_at).getTime() : 0;
      patch.premium_expires_at = new Date(Math.max(oneYear, current)).toISOString();
    } else {
      patch.premium_expires_at = null;
    }
  }
  if (typeof is_admin === 'boolean') {
    patch.is_admin = is_admin;
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Provide at least one of: suspended, is_premium, is_admin' });
  }
  // Guard: an admin must not strip their own admin or suspend themselves and
  // lock the dashboard out from under their feet (ADM-002).
  if (id === req.userId && (patch.is_admin === false || patch.suspended_at)) {
    return res.status(400).json({ error: 'You cannot suspend or de-admin your own account here' });
  }
  // Guard: don't remove admin from the LAST remaining admin (ADM-002) — that
  // would leave the app with no one able to reach the admin dashboard.
  if (patch.is_admin === false && existing.is_admin) {
    const { count } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('is_admin', true);
    if ((count ?? 0) <= 1) {
      return res.status(400).json({ error: 'Cannot remove the last remaining admin' });
    }
  }
  try {
    const { data, error } = await supabase
      .from('users')
      .update(patch)
      .eq('id', id)
      .select(ADMIN_USER_FIELDS)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    // SC-213: when actively suspending, kill the user's refresh tokens so an
    // existing session can't refresh around the ban. Combined with the
    // suspended_at re-check in /auth/refresh, the ban bites within one
    // (short-lived) access-token lifetime instead of never. Best-effort:
    // a revoke failure must not fail the suspend itself.
    if (patch.suspended_at) {
      await supabase
        .from('refresh_tokens')
        .update({ revoked: true })
        .eq('user_id', id)
        .eq('revoked', false);
    }
    return res.json({ user: data });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to update user' });
  }
}
