/**
 * SC-356 · PROFILE POSTS — personal, Instagram-style posts on a user's own wall.
 *
 * Deliberately separate from community posts end to end: its own table, its own
 * likes/comments tables, its own endpoints. A profile post can't reach the
 * Community feed and a community post can't reach a profile wall, because
 * neither query can see the other's table.
 *
 * Shared with the community side on purpose:
 *  - the 5/month free-tier cap (create_profile_post_capped counts BOTH tables)
 *  - `attachLikes` from community.controller — NOT a second hand-written read.
 *    SC-348 was exactly that bug (is_liked never returned, so the heart reset on
 *    every refetch); reusing the helper is the cheapest way not to repeat it.
 *  - the image-URL allowlist (firstDisallowedImageUrl), profanity, block filter.
 */

import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { LIMITS, firstDisallowedImageUrl, firstInvalidUrl } from '../utils/validation';
import { isPremiumActive } from '../utils/premium';
import { blockedUserIds } from '../utils/blocks';
import { normalizeClientKey } from '../utils/idempotency';
import { attachLikes, detectProfanity } from './community.controller';

const AUTHOR_SELECT = 'author:users!author_id!inner(id, name, username, profile_picture_url, is_premium)';
const MAX_MEDIA = 4;

/** Shared validation for create + update. Returns an error response or null. */
function validateBody(content: unknown, media: unknown, link: unknown):
  { status: number; body: Record<string, unknown> } | null {
  const text = typeof content === 'string' ? content : '';
  const urls = Array.isArray(media) ? media.filter((u): u is string => typeof u === 'string' && u !== '') : [];

  if (text.trim().length === 0 && urls.length === 0) {
    return { status: 400, body: { error: 'Add some text or at least one image.' } };
  }
  if (text.length > LIMITS.postTextMax) {
    return { status: 400, body: { error: `Post must be ${LIMITS.postTextMax} characters or fewer` } };
  }
  const detected = detectProfanity(text);
  if (detected.length > 0) {
    return { status: 400, body: { error: 'PROFANITY_DETECTED', detected_words: detected } };
  }
  if (urls.length > MAX_MEDIA) {
    return { status: 400, body: { error: `Maximum ${MAX_MEDIA} images per post` } };
  }
  for (const u of urls) {
    if (firstDisallowedImageUrl({ img: u }, ['img'])) {
      return { status: 400, body: { error: 'media_urls must be uploaded image URLs', code: 'INVALID_IMAGE_URL' } };
    }
  }
  // A profile post may carry an external link — protocol-only validation, the
  // same split community posts use (image fields are allowlisted to our storage,
  // link fields are genuinely external).
  if (link !== undefined && link !== null && link !== '' && firstInvalidUrl({ link }, ['link'])) {
    return { status: 400, body: { error: 'link_url must be a valid http(s) URL' } };
  }
  return null;
}

// ─── CREATE ─────────────────────────────────────────────────────────────────
export async function createProfilePost(req: Request, res: Response) {
  const userId = req.userId!;
  const { content, media_urls, link_url, idempotency_key } = req.body ?? {};

  const invalid = validateBody(content, media_urls, link_url);
  if (invalid) return res.status(invalid.status).json(invalid.body);

  const { data: user } = await supabase
    .from('users')
    .select('is_premium, premium_expires_at')
    .eq('id', userId)
    .single();
  const isPremium = isPremiumActive(user);

  const urls = Array.isArray(media_urls)
    ? media_urls.filter((u: unknown): u is string => typeof u === 'string' && u !== '')
    : [];

  // The cap + dedup + insert happen inside one advisory-locked transaction, so
  // concurrent creates can't each pass a stale count (the SC-60 rule).
  const { data, error } = await supabase
    .rpc('create_profile_post_capped', {
      p_author_id: userId,
      p_is_premium: isPremium,
      p_content: (typeof content === 'string' ? content : '').trim(),
      p_media_urls: urls.length > 0 ? urls : null,
      p_link_url: link_url || null,
      p_client_key: normalizeClientKey(idempotency_key),
    })
    .single();

  if (error) {
    if ((error as { message?: string }).message?.includes('POST_LIMIT_REACHED')) {
      return res.status(403).json({
        error: 'You’ve used all 5 free posts this month. Upgrade to Premium for unlimited posts.',
        code: 'POST_LIMIT_REACHED',
      });
    }
    return res.status(500).json({ error: sanitizeError(error) });
  }
  return res.status(201).json({ post: data, data });
}

// ─── LIST (one user's wall) ─────────────────────────────────────────────────
export async function listProfilePosts(req: Request, res: Response) {
  const viewerId = req.userId;
  const authorId = (req.query.user_id ?? req.query.author_id) as string | undefined;
  if (!authorId) return res.status(400).json({ error: 'user_id is required' });

  const pageSize = Math.min(parseInt((req.query.limit as string) || '20', 10) || 20, 50);
  const cursor = req.query.cursor as string | undefined;

  // SC-81/82: a blocked author's wall is not readable (either direction).
  if (viewerId && authorId !== viewerId) {
    const blocked = await blockedUserIds(viewerId);
    if (blocked.has(authorId)) {
      return res.json({ posts: [], items: [], total: 0, nextCursor: null, hasMore: false });
    }
  }

  let q = supabase
    .from('profile_posts')
    .select(`*, ${AUTHOR_SELECT}`)
    .eq('author_id', authorId)
    // SC-356: strictly newest-first with `id` as the FINAL tie-break, so keyset
    // pagination has a total order and can't skip or repeat rows that share a
    // timestamp (the SC-138 rule, applied to the new table from day one).
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize);

  if (cursor) {
    const [cts, cid] = String(cursor).split('|');
    if (cid) q = q.or(`created_at.lt.${cts},and(created_at.eq.${cts},id.lt.${cid})`);
    else q = q.lt('created_at', cts);
  }

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: sanitizeError(error) });

  const items = data || [];
  // SC-348 guard: per-viewer liked state via the SHARED helper.
  await attachLikes(items as Array<{ id: string; is_liked?: boolean }>, viewerId, 'profile_post_likes');

  const { count } = await supabase
    .from('profile_posts')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', authorId);

  const last = items[items.length - 1] as { created_at?: string; id?: string } | undefined;
  return res.json({
    posts: items,
    items,
    total: count ?? 0,
    nextCursor: items.length === pageSize && last ? `${last.created_at}|${last.id}` : null,
    hasMore: items.length === pageSize,
  });
}

// ─── GET ONE ────────────────────────────────────────────────────────────────
export async function getProfilePost(req: Request, res: Response) {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('profile_posts')
    .select(`*, ${AUTHOR_SELECT}`)
    .eq('id', id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: sanitizeError(error) });
  if (!data) return res.status(404).json({ error: 'Post not found' });

  if (req.userId) {
    const blocked = await blockedUserIds(req.userId);
    if (blocked.has((data as { author_id: string }).author_id)) {
      return res.status(404).json({ error: 'Post not found' });
    }
  }
  await attachLikes([data as { id: string; is_liked?: boolean }], req.userId, 'profile_post_likes');
  return res.json({ post: data, data });
}

// ─── UPDATE (author only) ───────────────────────────────────────────────────
export async function updateProfilePost(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { content, media_urls, link_url } = req.body ?? {};

  // Read the current row so a partial edit is validated against the RESULT, not
  // against the patch alone — otherwise clearing the text of an image-only post
  // (or the images of a text-only one) could leave an empty post.
  const { data: current } = await supabase
    .from('profile_posts')
    .select('content, media_urls, link_url')
    .eq('id', id)
    .eq('author_id', userId)
    .maybeSingle();
  if (!current) return res.status(404).json({ error: 'Post not found or not yours' });

  const nextContent = content !== undefined ? content : current.content;
  const nextMedia = media_urls !== undefined ? media_urls : current.media_urls;
  const nextLink = link_url !== undefined ? link_url : current.link_url;

  const invalid = validateBody(nextContent, nextMedia, nextLink);
  if (invalid) return res.status(invalid.status).json(invalid.body);

  const urls = Array.isArray(nextMedia)
    ? nextMedia.filter((u: unknown): u is string => typeof u === 'string' && u !== '')
    : [];

  const { data, error } = await supabase
    .from('profile_posts')
    .update({
      content: (typeof nextContent === 'string' ? nextContent : '').trim(),
      media_urls: urls.length > 0 ? urls : null,
      link_url: nextLink || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('author_id', userId)
    .select(`*, ${AUTHOR_SELECT}`)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Post not found or not yours' });
  // SC-348 guard again: every response that carries a post must carry is_liked,
  // otherwise a caller that renders straight from the update response paints an
  // empty heart over a post the viewer has liked.
  await attachLikes([data as { id: string; is_liked?: boolean }], userId, 'profile_post_likes');
  return res.json({ post: data, data });
}

// ─── DELETE (author only) ───────────────────────────────────────────────────
export async function deleteProfilePost(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { data, error } = await supabase
    .from('profile_posts')
    .delete()
    .eq('id', id)
    .eq('author_id', userId)
    .select('id');
  if (error) return res.status(500).json({ error: sanitizeError(error) });
  // Owner check is the WHERE clause, not a hidden button: someone else's id
  // deletes 0 rows → 404, same shape as SC-32/SC-355.
  if (!data || data.length === 0) return res.status(404).json({ error: 'Post not found or not yours' });
  return res.json({ success: true });
}

// ─── LIKE / UNLIKE ──────────────────────────────────────────────────────────
export async function likeProfilePost(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { error } = await supabase
    .from('profile_post_likes')
    .insert({ post_id: id, user_id: userId });
  // 23505 = already liked → idempotent success, not an error the UI must handle.
  if (error && (error as { code?: string }).code !== '23505') {
    return res.status(400).json({ error: sanitizeError(error) });
  }
  const { data } = await supabase.from('profile_posts').select('likes_count').eq('id', id).maybeSingle();
  return res.json({ liked: true, like_count: data?.likes_count ?? 0 });
}

export async function unlikeProfilePost(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  await supabase.from('profile_post_likes').delete().eq('post_id', id).eq('user_id', userId);
  const { data } = await supabase.from('profile_posts').select('likes_count').eq('id', id).maybeSingle();
  return res.json({ liked: false, like_count: data?.likes_count ?? 0 });
}

// ─── COMMENTS ───────────────────────────────────────────────────────────────
export async function listProfilePostComments(req: Request, res: Response) {
  const { id } = req.params;
  const pageSize = Math.min(parseInt((req.query.limit as string) || '50', 10) || 50, 100);
  const offset = Math.max(parseInt((req.query.offset as string) || '0', 10) || 0, 0);

  const { data, error, count } = await supabase
    .from('profile_post_comments')
    .select(`*, ${AUTHOR_SELECT}`, { count: 'exact' })
    .eq('post_id', id)
    .order('created_at', { ascending: true })
    .range(offset, offset + pageSize - 1);
  if (error) return res.status(500).json({ error: sanitizeError(error) });

  const total = count ?? 0;
  return res.json({
    comments: data || [],
    total,
    limit: pageSize,
    offset,
    has_more: offset + (data?.length ?? 0) < total,
  });
}

export async function addProfilePostComment(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { content } = req.body ?? {};

  if (typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: 'Comment is required' });
  }
  if (content.length > LIMITS.postTextMax) {
    return res.status(400).json({ error: `Comment must be ${LIMITS.postTextMax} characters or fewer` });
  }
  const detected = detectProfanity(content);
  if (detected.length > 0) {
    return res.status(400).json({ error: 'PROFANITY_DETECTED', detected_words: detected });
  }

  const { data: post } = await supabase.from('profile_posts').select('author_id').eq('id', id).maybeSingle();
  if (!post) return res.status(404).json({ error: 'Post not found' });
  // Can't comment on a wall you're blocked from (either direction).
  const blocked = await blockedUserIds(userId);
  if (blocked.has((post as { author_id: string }).author_id)) {
    return res.status(403).json({ error: 'You can’t comment on this post.' });
  }

  const { data, error } = await supabase
    .from('profile_post_comments')
    .insert({ post_id: id, author_id: userId, content: content.trim() })
    .select(`*, ${AUTHOR_SELECT}`)
    .single();
  if (error) return res.status(500).json({ error: sanitizeError(error) });
  return res.status(201).json({ comment: data, data });
}

export async function deleteProfilePostComment(req: Request, res: Response) {
  const userId = req.userId!;
  const { commentId } = req.params;
  // Comment author OR the wall owner can remove a comment.
  const { data: row } = await supabase
    .from('profile_post_comments')
    .select('id, author_id, post_id')
    .eq('id', commentId)
    .maybeSingle();
  if (!row) return res.status(404).json({ error: 'Comment not found' });

  let allowed = row.author_id === userId;
  if (!allowed) {
    const { data: post } = await supabase
      .from('profile_posts')
      .select('author_id')
      .eq('id', row.post_id)
      .maybeSingle();
    allowed = post?.author_id === userId;
  }
  if (!allowed) return res.status(403).json({ error: 'Not yours to delete' });

  await supabase.from('profile_post_comments').delete().eq('id', commentId);
  return res.json({ success: true });
}
