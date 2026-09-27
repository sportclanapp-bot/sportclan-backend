/**
 * Hard-delete list #1 (27 Sep 2026) · a deleted community post is marked, not
 * removed (migration 101).
 *
 * DELETE /community/posts/:id used to remove the row, and ON DELETE CASCADE
 * took other people's comments, the likes, and the reports made against the
 * post with it. The row now stays with deleted_at / deleted_by set, so all of
 * that stays too. Everything a normal user sees reads live posts only; an
 * admin still sees a deleted one, with its reports.
 */
import { supabase } from './supabase';

/** What a normal user gets for a deleted post: a 410 the app words as
 *  "This post was deleted". */
export const POST_DELETED = { error: 'This post was deleted', code: 'POST_DELETED' } as const;

/** #3: the same, when a moderator removed it (deleted_reason = 'moderator'). */
export const POST_REMOVED = { error: 'This post was removed by a moderator', code: 'POST_REMOVED' } as const;

/** Why a post or comment is gone. NULL on a row deleted before migration 103
 *  reads as the author's own delete — the only kind there was. */
export type DeletedReason = 'author' | 'moderator';

/** Was it a moderator's removal? */
export function isModeratorRemoval(row: { deleted_at?: string | null; deleted_reason?: string | null } | null | undefined): boolean {
  return !!row?.deleted_at && row.deleted_reason === 'moderator';
}

/** The 410 body for a gone post: deleted by its author, or removed by a moderator. */
export function postGone(row: { removed?: boolean; deleted_at?: string | null; deleted_reason?: string | null }) {
  return row.removed || isModeratorRemoval(row) ? POST_REMOVED : POST_DELETED;
}

/** Only posts that are not deleted. Applied to every read a normal user sees. */
export function livePosts<Q>(q: Q): Q {
  return (q as unknown as { is: (c: string, v: null) => Q }).is('deleted_at', null);
}

/** Is this post row deleted? */
export function isDeletedPost(row: { deleted_at?: string | null } | null | undefined): boolean {
  return !!row?.deleted_at;
}

/**
 * The post's author and whether it is deleted — one read for the write paths
 * (like, comment, vote, report, edit) that must refuse a deleted post.
 */
export async function postForWrite(id: string): Promise<{ author_id: string; deleted: boolean; removed: boolean; embargoed: boolean } | null> {
  const { data } = await supabase
    .from('community_posts')
    .select('author_id, deleted_at, deleted_reason, scheduled_at')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const row = data as { author_id: string; deleted_at?: string | null; deleted_reason?: string | null; scheduled_at?: string | null };
  return { author_id: row.author_id, deleted: isDeletedPost(row), removed: isModeratorRemoval(row), embargoed: isEmbargoed(row) };
}

/**
 * B03-F13: a scheduled post not yet published. getPost hides it from everyone
 * but its author; the like, comment and comments-list paths must too — they
 * answered 200/201 to anyone holding the id.
 */
export function isEmbargoed(row: { scheduled_at?: string | null } | null | undefined, now: number = Date.now()): boolean {
  const at = row?.scheduled_at ? Date.parse(row.scheduled_at) : NaN;
  return Number.isFinite(at) && at > now;
}

/** Hidden from this viewer: embargoed and not theirs. */
export function hiddenFrom(post: { author_id: string; embargoed?: boolean }, userId: string | undefined): boolean {
  return !!post.embargoed && post.author_id !== userId;
}

/**
 * Mark a post deleted, and hide the notifications about it (likes, comments,
 * mentions, new-post). Neither is removed. Returns false when there was no live
 * post to delete (missing, already deleted, or — with `authorId` — not theirs).
 */
export async function softDeletePost(
  id: string,
  deletedBy: string,
  opts: { authorId?: string; reason?: DeletedReason } = {},
): Promise<boolean> {
  const now = new Date().toISOString();
  let q = supabase
    .from('community_posts')
    .update({ deleted_at: now, deleted_by: deletedBy, deleted_reason: opts.reason ?? 'author' })
    .eq('id', id)
    .is('deleted_at', null);
  if (opts.authorId) q = q.eq('author_id', opts.authorId);
  const { data, error } = await q.select('id');
  if (error) throw error;
  if (!data || data.length === 0) return false;
  await supabase
    .from('notifications')
    .update({ hidden_at: now })
    .eq('data->>post_id', id)
    .is('hidden_at', null);
  return true;
}

// ── Hard-delete list #2 (27 Sep 2026) · comments, the same way (migration 102) ──
//
// DELETE /community/comments/:commentId used to remove the row, and ON DELETE
// CASCADE took the replies to it and the reports against it. The row now stays
// with deleted_at / deleted_by set. In a thread a normal user reads a
// placeholder, "This comment was deleted", so the replies still answer
// something; an admin reads the text.

/** What a normal user gets for acting on a deleted comment. */
export const COMMENT_DELETED = { error: 'This comment was deleted', code: 'COMMENT_DELETED' } as const;

/** #3: the same, when a moderator removed it. */
export const COMMENT_REMOVED = { error: 'This comment was removed by a moderator', code: 'COMMENT_REMOVED' } as const;

/** The 410 body for a gone comment. */
export function commentGone(row: { removed?: boolean; deleted_at?: string | null; deleted_reason?: string | null }) {
  return row.removed || isModeratorRemoval(row) ? COMMENT_REMOVED : COMMENT_DELETED;
}

/** The comment's author, post and whether it is deleted — one read for the
 *  write paths (react, reply, report) that must refuse a deleted comment. */
export async function commentForWrite(id: string): Promise<{ author_id: string; post_id: string; deleted: boolean; removed: boolean } | null> {
  const { data } = await supabase
    .from('post_comments')
    .select('author_id, post_id, deleted_at, deleted_reason')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const row = data as { author_id: string; post_id: string; deleted_at?: string | null; deleted_reason?: string | null };
  return { author_id: row.author_id, post_id: row.post_id, deleted: !!row.deleted_at, removed: isModeratorRemoval(row) };
}

/**
 * A deleted comment as a normal user sees it in its thread: its place and
 * time, and nothing it said or who said it.
 */
export function asDeletedPlaceholder<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    content: null,
    mentions: [],
    reactions: {},
    author_id: null,
    author: null,
    deleted: true,
    // #3: "removed by a moderator" rather than "deleted"
    removed_by_moderator: row.deleted_reason === 'moderator',
  };
}

/**
 * Mark a comment deleted, and hide the notifications about it (the new
 * comment / reply, a mention in it). Neither is removed. False when there was
 * no live comment to delete (missing, already deleted, or not theirs).
 */
export async function softDeleteComment(
  id: string,
  deletedBy: string,
  opts: { authorId?: string; reason?: DeletedReason } = {},
): Promise<boolean> {
  const now = new Date().toISOString();
  let q = supabase
    .from('post_comments')
    .update({ deleted_at: now, deleted_by: deletedBy, deleted_reason: opts.reason ?? 'author' })
    .eq('id', id)
    .is('deleted_at', null);
  if (opts.authorId) q = q.eq('author_id', opts.authorId);
  const { data, error } = await q.select('id');
  if (error) throw error;
  if (!data || data.length === 0) return false;
  await supabase
    .from('notifications')
    .update({ hidden_at: now })
    .eq('data->>comment_id', id)
    .is('hidden_at', null);
  return true;
}

// ── Hard-delete list #3 (27 Sep 2026) · a moderator's removal can be undone ──

const CONTENT = {
  post:            { table: 'community_posts',       key: 'post_id' },
  comment:         { table: 'post_comments',         key: 'comment_id' },
  // Wall posts and comments (reportable since migration 108) send no
  // notifications, so a restore has none to show again.
  profile_post:    { table: 'profile_posts',         key: null },
  profile_comment: { table: 'profile_post_comments', key: null },
} as const;

/** Content a moderator can remove and restore. */
export type ModeratedType = keyof typeof CONTENT;

/**
 * Restore a post or comment a MODERATOR removed. An author's own delete is not
 * restorable here — it was their choice. It comes back everywhere: the row is
 * live again (feeds, search, threads; the comments_count trigger adds the
 * comment back), and exactly the notifications the removal hid — matched on
 * its timestamp — are shown again. A comment that was deleted separately
 * keeps its own notifications hidden.
 */
export async function restoreRemovedContent(type: ModeratedType, id: string): Promise<boolean> {
  const c = CONTENT[type];
  const { data: row } = await supabase
    .from(c.table)
    .select('deleted_at, deleted_reason')
    .eq('id', id)
    .maybeSingle();
  const r = row as { deleted_at?: string | null; deleted_reason?: string | null } | null;
  if (!r || !isModeratorRemoval(r)) return false;
  const { data, error } = await supabase
    .from(c.table)
    .update({ deleted_at: null, deleted_by: null, deleted_reason: null })
    .eq('id', id)
    .eq('deleted_reason', 'moderator')
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) return false;
  if (c.key) {
    await supabase
      .from('notifications')
      .update({ hidden_at: null })
      .eq(`data->>${c.key}`, id)
      .eq('hidden_at', r.deleted_at as string);
  }
  return true;
}

// ── Wall posts and comments are reportable (27 Sep 2026, migration 108) ──

/** A wall comment's author, wall post and whether it is deleted / removed. */
export async function profileCommentForWrite(id: string): Promise<{ author_id: string; post_id: string; deleted: boolean; removed: boolean } | null> {
  const { data } = await supabase
    .from('profile_post_comments')
    .select('author_id, post_id, deleted_at, deleted_reason')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const row = data as { author_id: string; post_id: string; deleted_at?: string | null; deleted_reason?: string | null };
  return { author_id: row.author_id, post_id: row.post_id, deleted: !!row.deleted_at, removed: isModeratorRemoval(row) };
}

/** A moderator removes a wall post or wall comment — the #3 soft delete with
 *  deleted_reason 'moderator'. False when there was nothing live to remove. */
export async function moderatorRemoveWallItem(type: 'profile_post' | 'profile_comment', id: string, by: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(CONTENT[type].table)
    .update({ deleted_at: new Date().toISOString(), deleted_by: by, deleted_reason: 'moderator' })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id');
  if (error) throw error;
  return !!data && data.length > 0;
}

// ── Hard-delete list #4 (27 Sep 2026) · wall posts, the #1 way (migration 104) ──
//
// DELETE /profilePosts/:id used to remove the row, and the cascade took other
// people's comments and likes on it. The row now stays marked. Wall posts send
// no notifications and are in no feed or search, so the wall itself, its
// count, the post screen and the write paths are where it has to disappear.
// They can't be reported, so there is no moderator removal for them (yet).

/** A wall post's author and whether it is deleted. */
export async function profilePostForWrite(id: string): Promise<{ author_id: string; deleted: boolean; removed: boolean } | null> {
  const { data } = await supabase
    .from('profile_posts')
    .select('author_id, deleted_at, deleted_reason')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const row = data as { author_id: string; deleted_at?: string | null; deleted_reason?: string | null };
  return { author_id: row.author_id, deleted: !!row.deleted_at, removed: isModeratorRemoval(row) };
}

/** Mark the author's wall post deleted. False when there was no live post of
 *  theirs to delete (missing, already deleted, or not theirs). */
export async function softDeleteProfilePost(id: string, authorId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profile_posts')
    .update({ deleted_at: new Date().toISOString(), deleted_by: authorId, deleted_reason: 'author' })
    .eq('id', id)
    .eq('author_id', authorId)
    .is('deleted_at', null)
    .select('id');
  if (error) throw error;
  return !!data && data.length > 0;
}

// ── Hard-delete list #5 (27 Sep 2026) · wall-post comments (migration 105) ──
//
// Two people may delete one: its author, or the owner of the wall it is on.
// The row is marked with who and which — 'author' or 'wall_owner' — and keeps
// its place in the thread: "This comment was deleted" / "Removed by the wall
// owner". Wall comments have no replies, likes, edits or notifications.

export type WallCommentDeletedReason = 'author' | 'wall_owner' | 'moderator';

/** Mark a wall-post comment deleted. False when there was no live comment. */
export async function softDeleteProfileComment(
  id: string,
  deletedBy: string,
  reason: WallCommentDeletedReason,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('profile_post_comments')
    .update({ deleted_at: new Date().toISOString(), deleted_by: deletedBy, deleted_reason: reason })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id');
  if (error) throw error;
  return !!data && data.length > 0;
}

/** A deleted wall comment as the thread shows it: its place and time, and
 *  which kind of delete — nothing it said or who said it. */
export function asDeletedWallComment<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    content: null,
    author_id: null,
    author: null,
    deleted: true,
    removed_by_wall_owner: row.deleted_reason === 'wall_owner',
    removed_by_moderator: row.deleted_reason === 'moderator',
  };
}
