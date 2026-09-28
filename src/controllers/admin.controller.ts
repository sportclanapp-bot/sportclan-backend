import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { parsePagination, pageMeta, isRangeError } from '../utils/pagination';
import { sanitizeError } from '../utils/response';
import { orIlikeContains } from '../utils/likeSearch'; // SC-237
import axios from 'axios';
import crypto from 'crypto';
import { getLastOtpSend } from './auth.controller';
import {
  ModeratedType, commentForWrite, isModeratorRemoval, moderatorRemoveWallItem, postForWrite, profileCommentForWrite,
  profilePostForWrite, restoreRemovedContent, softDeleteComment, softDeletePost,
} from '../utils/postVisibility';
import { logAdminAction } from '../utils/tournamentAuth';

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
    const [users, posts, matches, tournaments, reports, newUsers] = await Promise.all([
      // Phase 3 B12-F10: live accounts and posts only — deleted ones aren't users or posts.
      safeCount(supabase.from('users').select('id', { count: 'exact', head: true }).is('deleted_at', null)),
      safeCount(
        supabase
          .from('community_posts')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', oneWeekAgoIso)
          .is('deleted_at', null),
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
      // B15: the tile that showed "premium" (there are no tiers) now counts
      // sign-ups in the last week.
      safeCount(
        supabase
          .from('users')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', oneWeekAgoIso)
          .is('deleted_at', null),
      ),
    ]);

    return res.json({
      user_count: users,
      // SC-435: `premium_count` was an active-subscriptions count. The table is
      // dropped by migration 091 and there are no tiers to count. Kept as an
      // explicit null so an older admin build renders its em-dash rather than
      // "undefined".
      premium_count: null,
      new_users_this_week: newUsers,
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
  // #3: ?status=actioned lists resolved reports with the action taken (and
  // Restore for a moderator's removal); the default is the open queue.
  const actioned = req.query.status === 'actioned';
  try {
    const { data: reports, error, count } = await supabase
      .from('content_reports')
      .select('id, target_type, target_id, reason, reporter_id, resolved, created_at, resolved_at, resolved_action, actioned_via', { count: 'exact' })
      .eq('resolved', actioned)
      .order(actioned ? 'resolved_at' : 'created_at', { ascending: false })
      .range(p.from, p.to);
    // Phase 3 B12-F6: a failed query is a failure — an empty 200 read as "the
    // queue is clear" during an outage. A page past the end is still empty.
    if (error && !isRangeError(error)) return res.status(500).json({ error: 'Could not load reports.' });
    if (error) return res.json({ reports: [], ...pageMeta(count, p) });
    const rows = reports ?? [];
    if (rows.length === 0) return res.json({ reports: [], ...pageMeta(count, p) });

    const postIds = [...new Set(rows.filter((r) => r.target_type === 'post').map((r) => r.target_id))];
    const commentIds = [...new Set(rows.filter((r) => r.target_type === 'comment').map((r) => r.target_id))];
    const messageIds = [...new Set(rows.filter((r) => r.target_type === 'message').map((r) => r.target_id))];
    const userTargetIds = rows.filter((r) => r.target_type === 'user').map((r) => r.target_id);
    // Wall posts and wall comments (migration 108) — deleted ones included too.
    const wallPostIds = [...new Set(rows.filter((r) => r.target_type === 'profile_post').map((r) => r.target_id))];
    const wallCommentIds = [...new Set(rows.filter((r) => r.target_type === 'profile_comment').map((r) => r.target_id))];
    type Held = { id: string; content: string; author_id: string; deleted_at?: string | null; deleted_by?: string | null; deleted_reason?: string | null };
    const [wallPostsRes, wallCommentsRes] = await Promise.all([
      wallPostIds.length
        ? supabase.from('profile_posts').select('id, content, author_id, deleted_at, deleted_by, deleted_reason').in('id', wallPostIds)
        : Promise.resolve({ data: [] as any[] }),
      wallCommentIds.length
        ? supabase.from('profile_post_comments').select('id, content, author_id, deleted_at, deleted_by, deleted_reason').in('id', wallCommentIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const wallMap = new Map<string, Held>([
      ...((wallPostsRes.data ?? []) as Held[]).map((w) => [`profile_post:${w.id}`, w] as [string, Held]),
      ...((wallCommentsRes.data ?? []) as Held[]).map((w) => [`profile_comment:${w.id}`, w] as [string, Held]),
    ]);

    // Fetch reported posts/comments/messages first so we can also resolve authors.
    const [postsRes, commentsRes, messagesRes] = await Promise.all([
      postIds.length
        // #1: deleted posts included — an admin still sees what was reported.
        ? supabase.from('community_posts').select('id, content, author_id, deleted_at, deleted_by, deleted_reason').in('id', postIds)
        : Promise.resolve({ data: [] as any[] }),
      commentIds.length
        // #2: deleted comments included — an admin still sees what was reported.
        ? supabase.from('post_comments').select('id, content, author_id, deleted_at, deleted_by, deleted_reason').in('id', commentIds)
        : Promise.resolve({ data: [] as any[] }),
      messageIds.length
        ? supabase.from('messages').select('id, content, sender_id').in('id', messageIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const posts = (postsRes.data ?? []) as Array<{ id: string; content: string; author_id: string; deleted_at?: string | null; deleted_by?: string | null; deleted_reason?: string | null }>;
    const comments = (commentsRes.data ?? []) as Array<{ id: string; content: string; author_id: string; deleted_at?: string | null; deleted_by?: string | null; deleted_reason?: string | null }>;
    const messages = (messagesRes.data ?? []) as Array<{ id: string; content: string; sender_id: string }>;

    // One batched user fetch: reporters + user-targets + content authors/senders.
    const userIds = [...new Set([
      ...rows.map((r) => r.reporter_id),
      ...userTargetIds,
      ...posts.map((p) => p.author_id),
      ...comments.map((c) => c.author_id),
      ...messages.map((m) => m.sender_id),
      ...[...wallMap.values()].map((w) => w.author_id),
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
      // #1: when the reported post was deleted, and whether its author did it.
      let content_deleted_at: string | null = null;
      let content_deleted_by_author = false;
      // #3: removed by a moderator — Restore is offered for this one.
      let content_removed_by_moderator = false;
      if (r.target_type === 'post') {
        const p = postMap.get(r.target_id);
        content_exists = !!p;
        content_preview = p ? String(p.content).slice(0, 240) : null;
        if (p) content_author = { id: p.author_id, name: userMap.get(p.author_id)?.name ?? null };
        content_deleted_at = p?.deleted_at ?? null;
        content_removed_by_moderator = isModeratorRemoval(p);
        content_deleted_by_author = !!p?.deleted_at && !content_removed_by_moderator && p.deleted_by === p.author_id;
      } else if (r.target_type === 'comment') {
        const c = commentMap.get(r.target_id);
        content_exists = !!c;
        content_preview = c ? String(c.content).slice(0, 240) : null;
        if (c) content_author = { id: c.author_id, name: userMap.get(c.author_id)?.name ?? null };
        content_deleted_at = c?.deleted_at ?? null;
        content_removed_by_moderator = isModeratorRemoval(c);
        content_deleted_by_author = !!c?.deleted_at && !content_removed_by_moderator && c.deleted_by === c.author_id;
      } else if (r.target_type === 'profile_post' || r.target_type === 'profile_comment') {
        const w = wallMap.get(`${r.target_type}:${r.target_id}`);
        content_exists = !!w;
        content_preview = w ? String(w.content ?? '').slice(0, 240) || '(photo)' : null;
        if (w) content_author = { id: w.author_id, name: userMap.get(w.author_id)?.name ?? null };
        content_deleted_at = w?.deleted_at ?? null;
        content_removed_by_moderator = isModeratorRemoval(w);
        content_deleted_by_author = !!w?.deleted_at && !content_removed_by_moderator && w.deleted_by === w.author_id;
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
        content_deleted_at,
        content_deleted_by_author,
        content_removed_by_moderator,
      };
    });
    return res.json({ reports: enriched, ...pageMeta(count, p) });
  } catch {
    return res.status(500).json({ error: 'Could not load reports.' });
  }
}

// PATCH /admin/reports/:id
// Body: { action?: 'remove' | 'restore' | 'dismiss' }  (default 'dismiss')
//   dismiss → this report resolved as 'dismissed'; the content is untouched.
//   remove  → hard-delete list #3: the post / comment is REMOVED BY A MODERATOR —
//             the #1 / #2 soft delete with deleted_reason 'moderator'. Nothing
//             hanging off it is lost (comments, replies, likes, reports). This
//             report resolves as 'removed'; the other open reports on the same
//             content resolve too, as 'removed' with actioned_via = this report.
//   restore → a moderator's removal undone: the content is live everywhere
//             again, and the reports that removed it read 'restored'. An
//             author's own delete can't be restored here — it was their choice.
// Every remove, restore and dismiss is also written to admin_actions (who, when, via).
export async function resolveReport(req: Request, res: Response) {
  const { id } = req.params;
  const raw = (req.body || {}).action;
  const action: 'remove' | 'restore' | 'dismiss' = raw === 'remove' || raw === 'restore' ? raw : 'dismiss';
  const adminId = req.userId!;
  try {
    // Existence check — a missing/already-handled id is a 404, not a silent ok.
    const { data: report, error: fetchErr } = await supabase
      .from('content_reports')
      .select('id, target_type, target_id, resolved, resolved_action')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const now = new Date().toISOString();
    const isContent = ['post', 'comment', 'profile_post', 'profile_comment'].includes(report.target_type);
    const type = report.target_type as ModeratedType;
    const resolution = (resolved_action: 'dismissed' | 'removed' | 'restored') =>
      ({ resolved: true, resolved_at: now, resolved_by: adminId, resolved_action });

    if (action === 'restore') {
      if (!isContent) return res.status(400).json({ error: 'Only a post or comment can be restored' });
      const restored = await restoreRemovedContent(type, report.target_id);
      if (!restored) {
        return res.status(409).json({ error: 'Only content a moderator removed can be restored.', code: 'NOT_REMOVED' });
      }
      const { error: updErr } = await supabase
        .from('content_reports')
        .update(resolution('restored'))
        .eq('target_type', report.target_type)
        .eq('target_id', report.target_id)
        .eq('resolved_action', 'removed');
      if (updErr) return res.status(500).json({ error: updErr.message });
      await logAdminAction(adminId, `restore_${type}`, type, report.target_id, `via report ${id}`);
      return res.json({ ok: true, action, contentRestored: true });
    }

    if (action === 'remove' && isContent) {
      const target = type === 'post' ? await postForWrite(report.target_id)
        : type === 'comment' ? await commentForWrite(report.target_id)
        : type === 'profile_post' ? await profilePostForWrite(report.target_id)
        : await profileCommentForWrite(report.target_id);
      if (!target) return res.status(404).json({ error: 'Reported content not found' });
      if (target.deleted && !target.removed) {
        // Its author already deleted it; there is nothing left to remove.
        return res.status(409).json({ error: 'Its author already deleted this.', code: 'ALREADY_DELETED' });
      }
      if (!target.deleted) {
        const removed = type === 'post'
          ? await softDeletePost(report.target_id, adminId, { reason: 'moderator' })
          : type === 'comment'
            ? await softDeleteComment(report.target_id, adminId, { reason: 'moderator' })
            : await moderatorRemoveWallItem(type, report.target_id, adminId);
        if (removed) await logAdminAction(adminId, `remove_${type}`, type, report.target_id, `via report ${id}`);
      }
      // This report, then the other open ones on the same content — kept, and
      // shown as already actioned through this one.
      const { error: e1 } = await supabase.from('content_reports').update(resolution('removed')).eq('id', id);
      if (e1) return res.status(500).json({ error: e1.message });
      const { error: e2 } = await supabase
        .from('content_reports')
        .update({ ...resolution('removed'), actioned_via: id })
        .eq('target_type', report.target_type)
        .eq('target_id', report.target_id)
        .eq('resolved', false)
        .neq('id', id);
      if (e2) return res.status(500).json({ error: e2.message });
      return res.json({ ok: true, action, contentRemoved: true });
    }

    const { error: updErr } = await supabase.from('content_reports').update(resolution('dismissed')).eq('id', id);
    if (updErr) return res.status(500).json({ error: updErr.message });
    await logAdminAction(adminId, 'dismiss_report', 'report', id, `${report.target_type} ${report.target_id}`);
    return res.json({ ok: true, action: 'dismiss', contentRemoved: false });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed' });
  }
}

// POST /admin/broadcast
// Body: { title, body, confirm? }
// Inserts one notification row per active user. For now this is a simple
// fan-out; a future version should batch + use a queue.
export const BROADCAST_TITLE_MAX = 80;
export const BROADCAST_BODY_MAX = 500;
const BROADCAST_PAGE = 1000;
export async function broadcastAnnouncement(req: Request, res: Response) {
  const { confirm } = req.body || {};
  // Phase 3 B12-F13: trimmed and capped (the app caps the body at 280).
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }
  if (!body) {
    return res.status(400).json({ error: 'body is required' });
  }
  if (title.length > BROADCAST_TITLE_MAX) {
    return res.status(400).json({ error: `Keep the title to ${BROADCAST_TITLE_MAX} characters or fewer.` });
  }
  if (body.length > BROADCAST_BODY_MAX) {
    return res.status(400).json({ error: `Keep the message to ${BROADCAST_BODY_MAX} characters or fewer.` });
  }

  try {
    // Active users (last 30 days), live and not suspended. Paged: a bare select
    // stops at PostgREST's 1000-row cap, which silently capped the broadcast.
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const users: Array<{ id: string }> = [];
    for (let from = 0; ; from += BROADCAST_PAGE) {
      const { data: page, error: usersErr } = await supabase
        .from('users')
        .select('id')
        .gte('last_active_at', cutoff)
        .is('deleted_at', null)
        .is('suspended_at', null)
        .order('id')
        .range(from, from + BROADCAST_PAGE - 1);
      if (usersErr) return res.status(500).json({ error: usersErr.message });
      users.push(...((page ?? []) as Array<{ id: string }>));
      if ((page ?? []).length < BROADCAST_PAGE) break;
    }

    const rows = users.map((u) => ({
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
    await logAdminAction(req.userId!, 'broadcast', 'broadcast', req.userId!, `"${title}" to ${rows.length} users`);

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
  'id, name, username, phone, email, is_admin, suspended_at, deleted_at, coin_balance, created_at';

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
// Body (any subset): { suspended?: boolean, is_admin?: boolean }
//   suspended  → sets/clears suspended_at (enforced at login)
//   is_admin   → toggles admin access
//
// SC-435: an `is_premium` toggle lived here, granting or revoking premium and
// juggling a 1-year expiry without clobbering a longer one (ADM-003). There are
// no tiers and the columns are dropped by migration 091, so it is gone. The
// last-admin guard (ADM-002) below is untouched.
export async function adminUpdateUser(req: Request, res: Response) {
  const { id } = req.params;
  const { suspended, is_admin } = req.body || {};

  // Fetch the target up front — needed to enforce the last-admin guard (ADM-002).
  const { data: existing } = await supabase
    .from('users')
    .select('id, is_admin, deleted_at')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'User not found' });
  // Phase 3 B12-F9: a deleted account has nothing to manage.
  if (existing.deleted_at) {
    return res.status(409).json({ error: 'This account is deleted.', code: 'ACCOUNT_DELETED' });
  }

  const patch: Record<string, unknown> = {};
  if (typeof suspended === 'boolean') {
    patch.suspended_at = suspended ? new Date().toISOString() : null;
  }
  if (typeof is_admin === 'boolean') {
    patch.is_admin = is_admin;
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Provide at least one of: suspended, is_admin' });
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
      .eq('is_admin', true)
      // Phase 3 B12-F14: only admins who can still sign in count.
      .is('deleted_at', null)
      .is('suspended_at', null);
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
    // Phase 3 B12-F3: every account change an admin makes is on the record.
    if ('suspended_at' in patch) {
      await logAdminAction(req.userId!, patch.suspended_at ? 'suspend_user' : 'unsuspend_user', 'user', id, null);
    }
    if (typeof patch.is_admin === 'boolean') {
      await logAdminAction(req.userId!, patch.is_admin ? 'grant_admin' : 'revoke_admin', 'user', id, null);
    }
    return res.json({ user: data });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to update user' });
  }
}

/**
 * SC-401 · GET /admin/otp-diagnostics
 *
 * Answers, from the vendor rather than from a dashboard reading:
 *   - what the SMS and VOICE balances actually are
 *   - what 2Factor reported for the last send this instance made
 *
 * Exists because the evidence conflicted: the dashboard showed 0.00 voice
 * credits, an explicit voice send returns 503, and yet a real handset received a
 * voice call from a request we made as SMS. Guessing at the vendor's behaviour
 * was not converging, so this asks it directly.
 */
export async function otpDiagnostics(_req: Request, res: Response) {
  const apiKey = process.env.TWOFACTOR_API_KEY;
  if (!apiKey) {
    return res.json({ configured: false, note: 'TWOFACTOR_API_KEY is not set on this instance.' });
  }
  const ask = async (path: string) => {
    try {
      const { data } = await axios.get(`https://2factor.in/API/V1/${apiKey}/${path}`, { timeout: 8000 });
      return data;
    } catch (err: any) {
      return { error: err?.response?.status ?? err?.message ?? 'request failed' };
    }
  };
  const [sms, voice, addon] = await Promise.all([
    ask('BAL/SMS'),
    ask('BAL/VOICE'),
    ask('BAL/ADDON_SERVICES'),
  ]);
  return res.json({
    configured: true,
    // Which key is live, without any of it (Phase 3 B12-F12: it showed 8 characters).
    keyFingerprint: crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 12),
    balances: { sms, voice, addon },
    lastSend: getLastOtpSend(),
  });
}

/** Decision 10: the two states an admin moves feedback between. */
export const FEEDBACK_STATUSES = ['open', 'resolved'] as const;

// GET /admin/feedback?status=open|resolved&limit&offset
// Decision 10 (B11-F11): nothing read the feedback table. Newest first, with
// who sent it. The default is every message.
export async function adminListFeedback(req: Request, res: Response) {
  const p = parsePagination(req.query as Record<string, unknown>, { defaultLimit: 30, maxLimit: 100 });
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  if (status !== undefined && !(FEEDBACK_STATUSES as readonly string[]).includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${FEEDBACK_STATUSES.join(', ')}` });
  }
  let q = supabase
    .from('feedback')
    .select('id, user_id, category, message, rating, email, status, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(p.from, p.to);
  if (status) q = q.eq('status', status);
  const { data, error, count } = await q;
  if (error && !isRangeError(error)) return res.status(500).json({ error: 'Could not load feedback.' });
  const rows = error ? [] : (data ?? []);
  const userIds = [...new Set(rows.map((r: any) => r.user_id).filter(Boolean))];
  const users = new Map<string, { id: string; name: string | null; username: string | null }>();
  if (userIds.length) {
    const { data: us } = await supabase.from('users').select('id, name, username').in('id', userIds);
    for (const u of (us ?? []) as Array<{ id: string; name: string | null; username: string | null }>) users.set(u.id, u);
  }
  const feedback = rows.map((r: any) => ({ ...r, user: users.get(r.user_id) ?? null }));
  return res.json({ feedback, ...pageMeta(count, p) });
}

// PATCH /admin/feedback/:id  { status: 'open' | 'resolved' }
export async function adminUpdateFeedback(req: Request, res: Response) {
  const { id } = req.params;
  const { status } = req.body || {};
  if (!(FEEDBACK_STATUSES as readonly unknown[]).includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${FEEDBACK_STATUSES.join(', ')}` });
  }
  const { data, error } = await supabase.from('feedback').update({ status }).eq('id', id).select('id, status').maybeSingle();
  if (error) return res.status(500).json({ error: 'Could not update that feedback.' });
  if (!data) return res.status(404).json({ error: 'Feedback not found.' });
  await logAdminAction(req.userId!, status === 'resolved' ? 'resolve_feedback' : 'reopen_feedback', 'feedback', id, null);
  return res.json({ feedback: data });
}
