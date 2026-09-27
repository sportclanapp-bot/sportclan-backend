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
export async function postForWrite(id: string): Promise<{ author_id: string; deleted: boolean } | null> {
  const { data } = await supabase
    .from('community_posts')
    .select('author_id, deleted_at')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const row = data as { author_id: string; deleted_at?: string | null };
  return { author_id: row.author_id, deleted: isDeletedPost(row) };
}

/**
 * Mark a post deleted, and hide the notifications about it (likes, comments,
 * mentions, new-post). Neither is removed. Returns false when there was no live
 * post to delete (missing, already deleted, or — with `authorId` — not theirs).
 */
export async function softDeletePost(
  id: string,
  deletedBy: string,
  opts: { authorId?: string } = {},
): Promise<boolean> {
  const now = new Date().toISOString();
  let q = supabase
    .from('community_posts')
    .update({ deleted_at: now, deleted_by: deletedBy })
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
