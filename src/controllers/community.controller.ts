import { isPremiumActive } from '../utils/premium';
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { normalizeClientKey } from '../utils/idempotency';
import { LIMITS, ARRAY_LIMITS, tooManyItems, firstDisallowedImageUrl } from '../utils/validation';
import { excludeDeleted, excludeDeletedEmbed } from '../utils/activeUser';
import { blockedUserIds, excludeIds, isBlockedBetween } from '../utils/blocks';
import { istDay, istDayStartIso, istMonthStartIso } from '../utils/appTime';
import { parsePagination } from '../utils/pagination';
import { notifyUsers } from '../utils/notify';

/** Short display name for a user id, for notification bodies. Best-effort. */
async function displayName(userId: string): Promise<string> {
  try {
    const { data } = await supabase.from('users').select('name, username').eq('id', userId).maybeSingle();
    return (data?.name || data?.username || 'Someone') as string;
  } catch {
    return 'Someone';
  }
}

/** SC-204: fire-and-forget engagement notification (comment / like / reaction).
 *  EVERYTHING here — the actor-name lookup, prefs/block/self/deleted filtering
 *  (notifyUsers), and the insert+push — runs OFF the response path inside a
 *  `void` async with `.catch`, so a notification failure or its cost can NEVER
 *  affect the underlying action's response (SC-112). Self is skipped up front. */
function notifyEngagement(
  recipientId: string | null | undefined,
  actorId: string,
  opts: { type: string; title: string; data: Record<string, string>; body: (actorName: string) => string },
): void {
  if (!recipientId || recipientId === actorId) return;
  void (async () => {
    const name = await displayName(actorId);
    await notifyUsers(
      [recipientId],
      { type: opts.type, title: opts.title, body: opts.body(name), data: opts.data },
      { actorId },
    );
  })().catch((err) =>
    // eslint-disable-next-line no-console
    console.error('[notify] engagement failed', opts.type, err),
  );
}

// ─── Basic profanity word list ───────────────────────────────────────────────
// SC-68: the original list was matched with a naive `lower.includes(w)` substring
// test, so short entries blocked innocent words that merely CONTAIN them —
// 'ass' killed association/class/pass/grass/assist, 'dick' killed Dickinson,
// 'crap' killed scrap/scrape, 'retard' killed (fire) retardant, 'randi' killed
// grandiose/brandish. Split the list by ambiguity:
//
//   PROFANITY_SUBSTRING — terms that never appear inside a normal word, so
//   substring matching is safe AND desirable (it also catches compounds like
//   'motherfucker', 'bullshit', 'dipshit').
//
//   PROFANITY_WORD — terms that DO occur inside innocent words, so match only as
//   whole words via \bword\b. Offensive compounds that whole-word matching would
//   otherwise miss (asshole, dumbass, dickhead, …) are listed explicitly so real
//   slurs are still blocked.
const PROFANITY_SUBSTRING = [
  'fuck', 'shit', 'bitch', 'damn', 'bastard', 'piss', 'slut', 'whore',
  'cunt', 'nigger', 'faggot',
  'madarchod', 'bhenchod', 'chutiya', 'gaandu', 'harami',
];

const PROFANITY_WORD = [
  'ass', 'asshole', 'asshat', 'asswipe', 'dumbass', 'jackass', 'smartass', 'badass',
  'dick', 'dickhead',
  'crap',
  'retard', 'retarded',
  'randi',
];

// Precompiled once. \b is a word boundary, so \bass\b matches "ass"/"kick his
// ass"/"bad-ass" but NOT "association"/"class"/"badass" (the latter is caught by
// its own explicit entry above).
const PROFANITY_WORD_RES = PROFANITY_WORD.map((w) => ({
  word: w,
  re: new RegExp(`\\b${w}\\b`, 'i'),
}));

function detectProfanity(text: string): string[] {
  const lower = text.toLowerCase();
  const hits = new Set<string>();
  for (const w of PROFANITY_SUBSTRING) {
    if (lower.includes(w)) hits.add(w);
  }
  for (const { word, re } of PROFANITY_WORD_RES) {
    if (re.test(lower)) hits.add(word);
  }
  return [...hits];
}

// ─── LIST POSTS (feed) ──────────────────────────────────────────────────────
export async function listPosts(req: Request, res: Response) {
  const { sport_id, city_id, post_type, author_id, user_id, cursor, limit = '20', sort } = req.query;
  // The app's profile grid sends `user_id`; the feed historically used
  // `author_id`. Accept either so "My posts" filters to the profile owner
  // instead of silently returning the whole feed.
  const authorFilter = (author_id ?? user_id) as string | undefined;
  const pageSize = Math.min(parseInt(limit as string, 10) || 20, 50);
  const sortMode = (sort as string) || 'recent';
  // SC-197: feed curation mode. for_you = the default feed (unchanged). following
  // = only posts by users the viewer follows. tournaments = only posts linked to a
  // match that belongs to a tournament (real data via the 057 match_id link).
  const mode = ((req.query.mode as string) || 'for_you').toLowerCase();
  // Tournaments needs the match embed as an INNER join so we can require a
  // non-null tournament on the linked match; other modes keep the outer embed so
  // ordinary (match-less) posts still appear.
  const matchJoin = mode === 'tournaments' ? 'matches!match_id!inner' : 'matches!match_id';
  // When trending, only consider posts from the last 24h and order by likes
  // desc. `likes_count` already exists on the table (post_likes count cache).
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // NOTE: this used to build two extra queries — a dead `user_account_types!inner`
  // builder that was never executed, and a second query whose result was
  // discarded — before running the real `q` below (A6-011). Both removed; `q`
  // is the single source of truth (and we no longer fire a wasted round-trip).
  // SC-77: `!inner` + excludeDeletedEmbed below drops posts whose author is a
  // soft-deleted account so they don't linger in the feed.
  let q = supabase
    .from('community_posts')
    .select(`
      *,
      author:users!author_id!inner(id, name, username, profile_picture_url, is_premium),
      sport:sports!sport_id(id, name, emoji),
      city:cities!city_id(id, name),
      match:${matchJoin}(id, team_a_name, team_b_name, status, winner_team_id, score_summary, sport_id, venue, tournament_id)
    `)
    .limit(pageSize);
  q = excludeDeletedEmbed(q, 'author');
  if (sortMode === 'trending') {
    // SC-138: deterministic order even when likes_count ties (created_at, then id).
    q = q
      .gte('created_at', since24h)
      .order('likes_count', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
  } else {
    // SC-138: id is the FINAL tie-break → a total order, so keyset pagination can
    // never skip posts that share a created_at (was: created_at only).
    q = q.order('created_at', { ascending: false }).order('id', { ascending: false });
  }

  if (sport_id) q = q.eq('sport_id', sport_id as string);
  if (city_id) q = q.eq('city_id', city_id as string);
  if (post_type) q = q.eq('post_type', post_type as string);
  if (authorFilter) q = q.eq('author_id', authorFilter);

  // SC-197: Following — restrict to authors the viewer follows. An unauthenticated
  // viewer or one who follows nobody gets an empty feed (not the global one).
  if (mode === 'following') {
    if (!req.userId) return res.json({ items: [], posts: [], nextCursor: null, hasMore: false });
    const { data: fr } = await supabase
      .from('follow_relationships')
      .select('following_id')
      .eq('follower_id', req.userId)
      .limit(2000);
    const followingIds = (fr ?? []).map((r: { following_id: string }) => r.following_id);
    if (followingIds.length === 0) {
      return res.json({ items: [], posts: [], nextCursor: null, hasMore: false });
    }
    q = q.in('author_id', followingIds);
  } else if (mode === 'tournaments') {
    // Only posts whose inner-joined match actually belongs to a tournament.
    q = q.not('match.tournament_id', 'is', null);
  }
  // SC-138: compound keyset cursor "created_at|id" — a post at the boundary
  // timestamp is no longer skipped (paginate on the (created_at, id) tuple).
  // Backward-compat: an OLD ts-only cursor (no "|") falls back to the previous
  // .lt('created_at') behaviour, so the current app keeps working mid-deploy.
  if (cursor && sortMode !== 'trending') {
    const [cts, cid] = String(cursor).split('|');
    if (cid) {
      q = q.or(`created_at.lt.${cts},and(created_at.eq.${cts},id.lt.${cid})`);
    } else {
      q = q.lt('created_at', cts);
    }
  }

  // Hide not-yet-published scheduled posts from everyone EXCEPT the author
  // viewing their own profile grid (author_id === the requester).
  const viewingOwn = authorFilter && authorFilter === req.userId;
  if (!viewingOwn) {
    q = q.is('scheduled_at', null);
  }

  // SC-81: hide posts authored by blocked-either-direction users from the feed.
  q = excludeIds(q, 'author_id', await blockedUserIds(req.userId));

  const result = await q;

  if (result.error) return res.status(500).json({ error: sanitizeError(result.error) });

  const items = result.data || [];
  return res.json({
    items,
    posts: items,
    nextCursor: items.length === pageSize
      ? (sortMode === 'trending'
          ? items[items.length - 1]?.created_at // trending doesn't keyset-paginate
          : `${items[items.length - 1]?.created_at}|${items[items.length - 1]?.id}`)
      : null,
    hasMore: items.length === pageSize,
  });
}

// ─── GET SPORT STORY COUNTS ─────────────────────────────────────────────────
// Powers the "Stories row" at the top of the community feed. Returns, per
// sport, how many posts exist newer than `since` (defaults to 7 days ago).
// The frontend passes the user's last-visit timestamp from AsyncStorage.
export async function getSportStoryCounts(req: Request, res: Response) {
  const since = (req.query.since as string) ||
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // SC-106: don't count posts whose author is soft-deleted (SC-77 `!inner` +
  // excludeDeletedEmbed) or blocked either direction (SC-82). Cosmetic count, so
  // keep it simple — just guard the source rows.
  let query = supabase
    .from('community_posts')
    .select('sport_id, sport:sports!sport_id(id, name, emoji), author:users!author_id!inner(id)')
    .gt('created_at', since)
    .not('sport_id', 'is', null)
    .is('scheduled_at', null); // SC-218: don't let unpublished scheduled posts inflate the story count
  query = excludeDeletedEmbed(query, 'author');
  query = excludeIds(query, 'author_id', await blockedUserIds(req.userId));
  const { data, error } = await query;

  if (error) return res.status(500).json({ error: sanitizeError(error) });

  const counts = new Map<string, { sport_id: string; name: string; emoji: string; count: number }>();
  for (const row of data || []) {
    const sport: any = row.sport;
    if (!sport?.id) continue;
    const existing = counts.get(sport.id);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(sport.id, { sport_id: sport.id, name: sport.name, emoji: sport.emoji, count: 1 });
    }
  }

  const result = Array.from(counts.values()).sort((a, b) => b.count - a.count);
  return res.json({ sports: result });
}

// ─── GET SINGLE POST ────────────────────────────────────────────────────────
export async function getPost(req: Request, res: Response) {
  const { id } = req.params;
  // SC-77: `!inner` on author → a post by a soft-deleted author returns no row,
  // so the post is no longer openable by direct id (treated as 404).
  // SC-81: also 404 if the author is blocked either direction (req.userId set
  // via optionalAuth on the route).
  let query = supabase
    .from('community_posts')
    .select(`
      *,
      author:users!author_id!inner(id, name, username, profile_picture_url, is_premium),
      sport:sports!sport_id(id, name, emoji),
      city:cities!city_id(id, name)
    `)
    .eq('id', id)
    .is('author.deleted_at', null);
  query = excludeIds(query, 'author_id', await blockedUserIds(req.userId));
  const { data, error } = await query.maybeSingle();

  if (error) return res.status(500).json({ error: sanitizeError(error) });
  if (!data) return res.status(404).json({ error: 'Post not found' });
  // SC-218: mirror the feed's embargo on this sibling path — a not-yet-published
  // scheduled post (scheduled_at in the future) is visible ONLY to its author.
  // The feed hid these; getPost didn't, so any user with the id could read an
  // embargoed post via direct GET.
  const sa = (data as { scheduled_at?: string | null }).scheduled_at;
  if (sa && new Date(sa).getTime() > Date.now() && (data as { author_id?: string }).author_id !== req.userId) {
    return res.status(404).json({ error: 'Post not found' });
  }
  return res.json({ data, post: data });
}

// ─── CREATE POST ────────────────────────────────────────────────────────────
export async function createPost(req: Request, res: Response) {
  const userId = req.userId!;
  const {
    content,
    text: textAlias, // frontend historically sends `text`
    image_url,
    media_urls, // frontend historically sends `media_urls: string[]`
    link_url,
    sport_id,
    city_id,
    post_type,
    mentions,
    idempotency_key,
    poll_options: rawPollOptions,
    type, // frontend sends 'type' which can be 'poll', 'general', etc.
    scheduled_at, // optional ISO string · Premium-only scheduled publishing
    match_id, // SC-193: optional — links a match_result post to a completed match
  } = req.body;

  // Normalise frontend field names to the columns we store.
  const bodyContent = (content ?? textAlias) as string | undefined;
  const bodyImage = (image_url ?? (Array.isArray(media_urls) ? media_urls[0] : undefined)) as
    | string
    | undefined;

  // SC-146/SC-147: validate any supplied image URL(s) point at our storage (https,
  // allowlisted host) — was UNVALIDATED (javascript:/data:/external/non-URL all passed).
  const imageCandidates = [image_url, ...(Array.isArray(media_urls) ? media_urls : [])];
  for (const cand of imageCandidates) {
    if (cand !== undefined && cand !== null && cand !== '' && firstDisallowedImageUrl({ img: cand }, ['img'])) {
      return res.status(400).json({ error: 'image_url must be an uploaded image URL', code: 'INVALID_IMAGE_URL' });
    }
  }

  if (!bodyContent || bodyContent.trim().length === 0) {
    return res.status(400).json({ error: 'Content is required' });
  }
  // Length cap (SC-40) — over-length previously hit the DB CHECK and 500'd.
  if (bodyContent.length > LIMITS.postTextMax) {
    return res.status(400).json({ error: `Post must be ${LIMITS.postTextMax} characters or fewer` });
  }

  // Profanity check
  const detected = detectProfanity(bodyContent);
  if (detected.length > 0) {
    return res.status(400).json({
      error: 'PROFANITY_DETECTED',
      detected_words: detected,
    });
  }
  // AUDIT-5: cap mentions array.
  if (tooManyItems(mentions, ARRAY_LIMITS.mentions)) {
    return res.status(400).json({ error: `Too many mentions (max ${ARRAY_LIMITS.mentions})` });
  }

  // Poll validation: accept string[] from frontend; convert to JSONB with
  // generated option_id + zero votes.
  let pollOptions: { id: string; text: string; vote_count: number }[] | null = null;
  if (type === 'poll' || Array.isArray(rawPollOptions)) {
    if (!Array.isArray(rawPollOptions) || rawPollOptions.length < 2 || rawPollOptions.length > 5) {
      return res.status(400).json({ error: 'Polls need 2-5 options' });
    }
    pollOptions = rawPollOptions.map((text: string, i: number) => ({
      id: `opt_${i + 1}`,
      text: String(text).trim().slice(0, 80),
      vote_count: 0,
    }));
  }

  // SC-144: ONE read of premium state, evaluated LIVE (is_premium + expiry) — drives
  // image posts, scheduling AND the free-tier post cap. Was two `.select('is_premium')`
  // reads gating on the stale flag (an expired-but-unflipped user kept these ~1h).
  const { data: user } = await supabase
    .from('users')
    .select('is_premium, premium_expires_at')
    .eq('id', userId)
    .single();
  const isPremium = isPremiumActive(user);

  // Premium-only image posts.
  if (bodyImage && !isPremium) {
    return res.status(403).json({ error: 'IMAGE_POSTS_PREMIUM' });
  }

  // Scheduled publishing · Premium-only, must be a future timestamp.
  // The publishScheduledPosts job clears scheduled_at once the time passes,
  // at which point the post becomes visible in the normal feed query.
  let scheduledAtIso: string | null = null;
  if (scheduled_at) {
    if (!isPremium) {
      return res.status(403).json({ error: 'SCHEDULING_PREMIUM' });
    }
    const when = new Date(scheduled_at);
    if (Number.isNaN(when.getTime())) {
      return res.status(400).json({ error: 'Invalid scheduled_at' });
    }
    if (when.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'scheduled_at must be in the future' });
    }
    scheduledAtIso = when.toISOString();
  }

  // SC-193: a match_result post must link a REAL completed match the author took
  // part in. Validate BEFORE inserting so we never persist a fabricated/foreign
  // scorecard link. Non-participant → 403; not-completed/absent → 400.
  let validatedMatchId: string | null = null;
  if (match_id) {
    const { data: m } = await supabase
      .from('matches')
      .select('id, status, created_by')
      .eq('id', match_id)
      .maybeSingle();
    if (!m || m.status !== 'completed') {
      return res
        .status(400)
        .json({ error: 'A result can only be shared for a completed match', code: 'MATCH_NOT_COMPLETED' });
    }
    let isParticipant = m.created_by === userId;
    if (!isParticipant) {
      const { data: part } = await supabase
        .from('match_participants')
        .select('id')
        .eq('match_id', match_id)
        .eq('user_id', userId)
        .maybeSingle();
      isParticipant = !!part;
    }
    if (!isParticipant) {
      return res
        .status(403)
        .json({ error: 'Only a participant can share this match result', code: 'NOT_MATCH_PARTICIPANT' });
    }
    validatedMatchId = m.id;
  }

  // SC-60: the 5-posts/month free-tier cap is enforced atomically inside
  // create_post_capped (migration 040) — a per-user pg_advisory_xact_lock makes
  // the count + insert one critical section, so concurrent creates can't all
  // pass a stale check-then-act and bypass the cap. Premium users bypass the cap
  // (p_is_premium). On the cap the RPC raises POST_LIMIT_REACHED -> same 403 shape.
  // SC-130: create_post_capped (mig 053) dedups a retry via p_client_key (or a 2s
  // backstop when no key) INSIDE the RPC — a retry never burns a monthly-cap slot.
  const rpcArgs: Record<string, any> = {
    p_author_id: userId,
    p_is_premium: isPremium,
    p_content: bodyContent.trim(),
    p_image_url: bodyImage || null,
    p_link_url: link_url || null,
    p_sport_id: sport_id || null,
    p_city_id: city_id || null,
    // A validated match link forces the match_result type so the feed card + the
    // SC-197 Tournaments filter key off it consistently.
    p_post_type: validatedMatchId ? 'match_result' : type || post_type || 'general',
    p_mentions: mentions || [],
    p_poll_options: pollOptions ?? null,
    p_scheduled_at: scheduledAtIso,
  };
  // SC-193: only attach p_match_id when there IS a link — so ordinary posts keep
  // resolving to the pre-057 RPC signature until migration 057 is applied.
  if (validatedMatchId) rpcArgs.p_match_id = validatedMatchId;
  let { data, error } = await supabase
    // SC-179: a non-UUID key would raise 22P02 (invalid uuid) → 500. Coerce a
    // malformed key to null so the post still succeeds (dedup just skipped).
    .rpc('create_post_capped', { ...rpcArgs, p_client_key: normalizeClientKey(idempotency_key) })
    .single();
  if (error && (error as { code?: string }).code === 'PGRST202') {
    // mig 053 not applied yet — the old signature has no p_client_key; retry without it.
    ({ data, error } = await supabase.rpc('create_post_capped', rpcArgs).single());
  }

  if (error) {
    if ((error as { message?: string }).message?.includes('POST_LIMIT_REACHED')) {
      return res.status(403).json({ error: 'POST_LIMIT_REACHED' });
    }
    return res.status(500).json({ error: sanitizeError(error) });
  }

  // Award coins: 2 per post, capped at 5/day via a date-scoped event type.
  try {
    const { awardCoins } = await import('../utils/coins');
    // SC-92: bucket the daily coin award by IST day (agrees with check-in).
    const today = istDay();
    const { count: postsToday } = await supabase
      .from('community_posts')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', userId)
      .gte('created_at', istDayStartIso());
    const todayN = postsToday ?? 1;
    if (todayN <= 5) {
      void awardCoins(userId, `community_post_${today}_${todayN}`, 2);
    }
  } catch {
    // best-effort
  }
  return res.status(201).json({ data, post: data });
  return res.status(201).json({ data, post: data });
}

// ─── UPDATE POST ────────────────────────────────────────────────────────────
export async function updatePost(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { content, sport_id, city_id, post_type, link_url } = req.body;

  if (content) {
    if (content.length > LIMITS.postTextMax) {
      return res.status(400).json({ error: `Post must be ${LIMITS.postTextMax} characters or fewer` });
    }
    const detected = detectProfanity(content);
    if (detected.length > 0) {
      return res.status(400).json({ error: 'PROFANITY_DETECTED', detected_words: detected });
    }
  }

  const { data, error } = await supabase
    .from('community_posts')
    .update({
      ...(content !== undefined && { content: content.trim() }),
      ...(sport_id !== undefined && { sport_id }),
      ...(city_id !== undefined && { city_id }),
      ...(post_type !== undefined && { post_type }),
      ...(link_url !== undefined && { link_url }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('author_id', userId)
    .select()
    .single();

  // SC-32: a 0-row update (wrong owner or missing) must 404, not a false 200
  // with null data.
  if (error || !data) return res.status(404).json({ error: 'Post not found or not yours' });
  return res.json({ data, post: data });
}

// ─── DELETE POST ────────────────────────────────────────────────────────────
export async function deletePost(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  const { data: deleted, error } = await supabase
    .from('community_posts')
    .delete()
    .eq('id', id)
    .eq('author_id', userId)
    .select('id');

  if (error) return res.status(500).json({ error: error.message });
  // SC-32: a 0-row delete (wrong owner or missing) must 404, not a false 200.
  if (!deleted || deleted.length === 0) {
    return res.status(404).json({ error: 'Post not found or not yours' });
  }
  return res.json({ success: true });
}

// ─── CLOSE POST ─────────────────────────────────────────────────────────────
export async function closePost(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  const { data, error } = await supabase
    .from('community_posts')
    .update({ is_closed: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('author_id', userId)
    .select()
    .single();

  if (error) return res.status(404).json({ error: 'Post not found or not yours' });
  return res.json({ data });
}

// ─── LIKE / UNLIKE ──────────────────────────────────────────────────────────
export async function likePost(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  // Block gate: a blocked user (either direction) can't like the author's post.
  const { data: likePostRow } = await supabase
    .from('community_posts').select('author_id').eq('id', id).maybeSingle();
  if (!likePostRow) return res.status(404).json({ error: 'Post not found' });
  if (await isBlockedBetween(userId, likePostRow.author_id)) {
    return res.status(403).json({ error: 'BLOCKED' });
  }

  const { error } = await supabase
    .from('post_likes')
    .insert({ post_id: id, user_id: userId });

  if (error?.code === '23505') return res.json({ liked: true }); // already liked → no re-notify
  if (error) return res.status(500).json({ error: sanitizeError(error) });

  // SC-204: notify the post author of a NEW like (self-like already filtered).
  notifyEngagement(likePostRow.author_id, userId, {
    type: 'like',
    title: 'New like',
    body: (n) => `${n} liked your post`,
    data: { post_id: id, actor_id: userId },
  });
  return res.json({ liked: true });
}

export async function unlikePost(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  await supabase
    .from('post_likes')
    .delete()
    .eq('post_id', id)
    .eq('user_id', userId);

  return res.json({ liked: false });
}

// ─── COMMENTS ───────────────────────────────────────────────────────────────
export async function listComments(req: Request, res: Response) {
  const { id } = req.params;

  // SC-77: hide comments authored by a soft-deleted account.
  // SC-81: hide comments authored by blocked-either-direction users (viewer via
  // optionalAuth).
  const lcp = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
  let cq = supabase
    .from('post_comments')
    .select(`
      *,
      author:users!author_id!inner(id, name, username, profile_picture_url, is_premium)
    `)
    .eq('post_id', id)
    .is('author.deleted_at', null)
    .order('created_at', { ascending: true })
    .range(lcp.from, lcp.to);
  cq = excludeIds(cq, 'author_id', await blockedUserIds(req.userId));
  const { data, error } = await cq;

  if (error) return res.status(500).json({ error: sanitizeError(error) });
  return res.json({ data: data || [], comments: data || [] });
}

export async function createComment(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { content, parent_id, mentions } = req.body;
  // SC-179: coerce a non-UUID key to null (client_key is uuid-typed) so a
  // malformed key can't 500 the comment insert — the comment still posts.
  const idempotency_key = normalizeClientKey(req.body?.idempotency_key);

  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: 'Content is required' });
  }
  if (content.length > LIMITS.postTextMax) {
    return res.status(400).json({ error: `Comment must be ${LIMITS.postTextMax} characters or fewer` });
  }
  // AUDIT-5: cap mentions array.
  if (tooManyItems(mentions, ARRAY_LIMITS.mentions)) {
    return res.status(400).json({ error: `Too many mentions (max ${ARRAY_LIMITS.mentions})` });
  }

  const detected = detectProfanity(content);
  if (detected.length > 0) {
    return res.status(400).json({ error: 'PROFANITY_DETECTED', detected_words: detected });
  }

  // Block gate: a blocked user (either direction) can't comment on the post.
  const { data: commentPostRow } = await supabase
    .from('community_posts').select('author_id').eq('id', id).maybeSingle();
  if (!commentPostRow) return res.status(404).json({ error: 'Post not found' });
  if (await isBlockedBetween(userId, commentPostRow.author_id)) {
    return res.status(403).json({ error: 'BLOCKED' });
  }

  // SC-130: idempotent comment. With a key → insert-first (unique index dedups a
  // retry → return the existing, not a 500). No key → a 2s backstop on
  // (post_id, author_id, content). Falls back if the client_key column isn't there yet.
  const commentSelect = `
      *,
      author:users!author_id(id, name, username, profile_picture_url, is_premium)
    `;
  const basePayload: Record<string, any> = {
    post_id: id,
    author_id: userId,
    parent_id: parent_id || null,
    content: content.trim(),
    mentions: mentions || [],
  };
  const insertComment = async (withKey: boolean) =>
    supabase
      .from('post_comments')
      .insert(withKey ? { ...basePayload, client_key: idempotency_key } : basePayload)
      .select(commentSelect)
      .single();

  if (!idempotency_key) {
    // No-key backstop: identical comment on the same post within 2s = a retry.
    const { data: recent } = await supabase
      .from('post_comments')
      .select('id')
      .eq('post_id', id)
      .eq('author_id', userId)
      .eq('content', content.trim())
      .gt('created_at', new Date(Date.now() - 2000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent) {
      const { data: existing } = await supabase.from('post_comments').select(commentSelect).eq('id', recent.id).single();
      return res.status(200).json({ data: existing, comment: existing, alreadyPosted: true });
    }
  }

  let ins = await insertComment(!!idempotency_key);
  // Same-key retry → unique violation on uq_post_comments_author_client_key → return
  // the original comment. CHECK THIS FIRST: the 23505 message contains the substring
  // 'client_key' (the constraint name), so it must not be mistaken for a missing column.
  if (idempotency_key && (ins.error as { code?: string } | null)?.code === '23505') {
    const { data: existing } = await supabase
      .from('post_comments').select(commentSelect)
      .eq('author_id', userId).eq('client_key', idempotency_key).maybeSingle();
    return res.status(200).json({ data: existing, comment: existing, alreadyPosted: true });
  }
  // Pre-migration fallback: the client_key COLUMN isn't there yet (PostgREST schema-cache
  // miss, code PGRST204) — retry the insert without it.
  if (ins.error && (ins.error as { code?: string }).code === 'PGRST204') {
    ins = await insertComment(false);
  }
  if (ins.error) return res.status(500).json({ error: sanitizeError(ins.error) });

  // SC-204: notify the post author of the new comment (the alreadyPosted/dedup
  // paths above return 200 and never reach here, so a retry never re-notifies).
  const newCommentId = (ins.data as { id?: string } | null)?.id ?? '';
  notifyEngagement(commentPostRow.author_id, userId, {
    type: 'comment',
    title: 'New comment',
    body: (n) => `${n} commented on your post`,
    data: { post_id: id, comment_id: newCommentId, actor_id: userId },
  });
  // On a REPLY, also notify the PARENT comment's author — but only if they're not
  // the post author (already notified above) and not the replier (self-filtered).
  if (parent_id) {
    const { data: parent } = await supabase
      .from('post_comments').select('author_id').eq('id', parent_id).maybeSingle();
    if (parent?.author_id && parent.author_id !== commentPostRow.author_id) {
      notifyEngagement(parent.author_id, userId, {
        type: 'comment',
        title: 'New reply',
        body: (n) => `${n} replied to your comment`,
        data: { post_id: id, comment_id: newCommentId, actor_id: userId },
      });
    }
  }
  return res.status(201).json({ data: ins.data, comment: ins.data });
}

export async function deleteComment(req: Request, res: Response) {
  const userId = req.userId!;
  const { commentId } = req.params;

  const { data: deleted, error } = await supabase
    .from('post_comments')
    .delete()
    .eq('id', commentId)
    .eq('author_id', userId)
    .select('id');

  if (error) return res.status(500).json({ error: error.message });
  // SC-32: a 0-row delete (wrong owner or missing) must 404, not a false 200.
  if (!deleted || deleted.length === 0) {
    return res.status(404).json({ error: 'Comment not found or not yours' });
  }
  return res.json({ success: true });
}

export async function reactToComment(req: Request, res: Response) {
  const userId = req.userId!;
  const { commentId } = req.params;
  const { emoji } = req.body;

  const validEmojis = ['❤️', '😂', '😮', '😢', '👏', '🔥'];
  if (!validEmojis.includes(emoji)) {
    return res.status(400).json({ error: 'Invalid emoji reaction' });
  }

  // Get current reactions
  const { data: comment } = await supabase
    .from('post_comments')
    .select('reactions, author_id, post_id')
    .eq('id', commentId)
    .single();

  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  // SC-96: block gate — can't react to a blocked-either-direction user's comment.
  if (await isBlockedBetween(userId, comment.author_id)) {
    return res.status(403).json({ error: 'BLOCKED' });
  }

  const reactions = (comment.reactions as Record<string, string[]>) || {};
  const users = reactions[emoji] || [];

  const added = !users.includes(userId);
  if (!added) {
    reactions[emoji] = users.filter((u: string) => u !== userId);
    if (reactions[emoji].length === 0) delete reactions[emoji];
  } else {
    reactions[emoji] = [...users, userId];
  }

  const { error } = await supabase
    .from('post_comments')
    .update({ reactions })
    .eq('id', commentId);

  if (error) return res.status(500).json({ error: sanitizeError(error) });

  // SC-204: notify the comment author only when a reaction is ADDED (a toggle-off
  // must not notify). Routes to the parent post.
  if (added) {
    notifyEngagement(comment.author_id, userId, {
      type: 'reaction',
      title: 'New reaction',
      body: (n) => `${n} reacted ${emoji} to your comment`,
      data: { post_id: comment.post_id, actor_id: userId },
    });
  }
  return res.json({ reactions });
}

// ─── REPORT ─────────────────────────────────────────────────────────────────
export async function reportContent(req: Request, res: Response) {
  const userId = req.userId!;
  // The app sends { target_type, target_id, reason }; older callers may send
  // { comment_id | post_id }. Normalize both onto the unified content_reports
  // shape that the admin moderation queue reads/resolves. (Previously this
  // wrote to comment_reports, which no admin code ever reads — so filed
  // reports never surfaced. Bridged here.)
  const { target_type, target_id, comment_id, post_id, user_id, message_id, reason } = req.body || {};

  if (!reason) return res.status(400).json({ error: 'Reason is required' });

  // SC-209: 'message' is now reportable alongside post/comment/user.
  let resolvedType: 'post' | 'comment' | 'user' | 'message' | null = null;
  let resolvedId: string | null = null;
  if (target_type && target_id) {
    if (!['post', 'comment', 'user', 'message'].includes(target_type)) {
      return res.status(400).json({ error: 'target_type must be post, comment, user, or message' });
    }
    resolvedType = target_type;
    resolvedId = target_id;
  } else if (comment_id) {
    resolvedType = 'comment'; resolvedId = comment_id;
  } else if (post_id) {
    resolvedType = 'post'; resolvedId = post_id;
  } else if (message_id) {
    resolvedType = 'message'; resolvedId = message_id;
  } else if (user_id) {
    resolvedType = 'user'; resolvedId = user_id;
  }
  if (!resolvedType || !resolvedId) {
    return res.status(400).json({ error: 'A target (post_id, comment_id, message_id, or user_id) is required' });
  }

  // SC-208: verify the target EXISTS (no orphan reports) and get its owner so we
  // can reject self-reports. 'user' targets are their own owner.
  let exists = false;
  let ownerId: string | null = null;
  if (resolvedType === 'post') {
    const { data: t } = await supabase.from('community_posts').select('author_id').eq('id', resolvedId).maybeSingle();
    exists = !!t; ownerId = (t as { author_id?: string } | null)?.author_id ?? null;
  } else if (resolvedType === 'comment') {
    const { data: t } = await supabase.from('post_comments').select('author_id').eq('id', resolvedId).maybeSingle();
    exists = !!t; ownerId = (t as { author_id?: string } | null)?.author_id ?? null;
  } else if (resolvedType === 'message') {
    const { data: t } = await supabase.from('messages').select('sender_id').eq('id', resolvedId).maybeSingle();
    exists = !!t; ownerId = (t as { sender_id?: string } | null)?.sender_id ?? null;
  } else {
    const { data: t } = await supabase.from('users').select('id').eq('id', resolvedId).maybeSingle();
    exists = !!t; ownerId = (t as { id?: string } | null)?.id ?? null;
  }
  if (!exists) return res.status(404).json({ error: 'Reported content not found' });
  // SC-208: no self-report (a user reporting themselves, or their own content).
  if (ownerId && ownerId === userId) {
    return res.status(400).json({ error: 'You can’t report your own content.' });
  }

  // SC-208: dedup — same reporter + same target = one report (no duplicate rows in
  // the moderation queue). Return the existing report instead of a new row.
  const { data: existingReport } = await supabase
    .from('content_reports')
    .select('*')
    .eq('reporter_id', userId)
    .eq('target_type', resolvedType)
    .eq('target_id', resolvedId)
    .maybeSingle();
  if (existingReport) {
    return res.status(200).json({ data: existingReport, alreadyReported: true });
  }

  const { data, error } = await supabase
    .from('content_reports')
    .insert({
      target_type: resolvedType,
      target_id: resolvedId,
      reporter_id: userId,
      reason,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: sanitizeError(error) });
  return res.status(201).json({ data });
}

// ─── MY POST COUNT THIS MONTH ───────────────────────────────────────────────
export async function getMyPostCount(req: Request, res: Response) {
  const userId = req.userId!;

  // SC-90: IST calendar month (was server-local/UTC) — mirrors create_post_capped.
  const startOfMonth = istMonthStartIso();

  const { count } = await supabase
    .from('community_posts')
    .select('id', { count: 'exact', head: true })
    .eq('author_id', userId)
    .gte('created_at', startOfMonth);

  const used = count ?? 0;
  const limit = 5;
  return res.json({ count: used, limit, remaining: Math.max(0, limit - used) });
}

// ─── CHECK IF USER LIKED ────────────────────────────────────────────────────
export async function checkLiked(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;

  const { data } = await supabase
    .from('post_likes')
    .select('id')
    .eq('post_id', id)
    .eq('user_id', userId)
    .maybeSingle();

  return res.json({ liked: !!data });
}

// ─── MENTION SEARCH ─────────────────────────────────────────────────────────
export async function searchMentions(req: Request, res: Response) {
  const { q } = req.query;
  // SC-104: `q` is interpolated into a PostgREST `.or()` filter, so raw commas,
  // parens or wildcards in the input let a caller break out of the ilike pattern
  // (filter injection). Strip PostgREST filter metacharacters + wildcards and
  // cap the length before use; if nothing usable remains, return an empty list.
  const safe = String(q ?? '').replace(/[,()%*\\]/g, '').trim().slice(0, 50);
  if (!safe) return res.json({ data: [], candidates: [] });

  // SC-104: also exclude soft-deleted users (SC-77) and block-filter either
  // direction (SC-82) so the mention picker never surfaces deleted or blocking
  // users — mirrors the players `search` path.
  const blocked = await blockedUserIds(req.userId);
  const { data, error } = await excludeIds(excludeDeleted(supabase
    .from('users')
    .select('id, name, username, profile_picture_url, is_premium')
    .or(`username.ilike.%${safe}%,name.ilike.%${safe}%`)), 'id', blocked)
    .limit(10);

  if (error) return res.status(500).json({ error: sanitizeError(error) });
  // Frontend uses { id, name, username, avatar_url } shape; map name → name
  const candidates = (data || []).map((u: any) => ({
    id: u.id,
    name: u.name,
    username: u.username,
    avatar_url: u.profile_picture_url,
  }));
  return res.json({ data: data || [], candidates });
}

// ─── VOTE ON POLL ───────────────────────────────────────────────────────────
export async function votePoll(req: Request, res: Response) {
  const userId = req.userId!;
  const { id } = req.params;
  const { option_id } = req.body;

  if (!option_id || typeof option_id !== 'string') {
    return res.status(400).json({ error: 'option_id is required' });
  }

  // 1. Fetch post; verify it's a poll
  const { data: post, error: fetchErr } = await supabase
    .from('community_posts')
    .select('id, poll_options, post_type, is_closed, author_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ error: sanitizeError(fetchErr) });
  if (!post) return res.status(404).json({ error: 'Post not found' });
  // SC-96: block gate — can't vote on a blocked-either-direction user's poll.
  if (await isBlockedBetween(userId, post.author_id)) {
    return res.status(403).json({ error: 'BLOCKED' });
  }
  if (!post.poll_options) return res.status(400).json({ error: 'Not a poll post' });
  // SC-43: a closed poll is final — no more votes.
  if (post.is_closed) return res.status(409).json({ error: 'This poll is closed' });

  const options = post.poll_options as Array<{ id: string; text: string; vote_count: number }>;
  if (!options.find((o) => o.id === option_id)) {
    return res.status(400).json({ error: 'Invalid option_id' });
  }

  // 2. Get existing vote (if any) to know what to decrement
  const { data: existing } = await supabase
    .from('poll_votes')
    .select('option_id')
    .eq('post_id', id)
    .eq('user_id', userId)
    .maybeSingle();

  const previousOptionId = existing?.option_id ?? null;
  if (previousOptionId === option_id) {
    // No change — still return current state
    return res.json({ post });
  }

  // 3. SC-61: upsert the vote AND recompute the denormalized
  // poll_options[].vote_count atomically (apply_poll_vote, migration 041). The
  // old flow upserted, then in a separate statement read-all-recompute-wrote the
  // whole JSONB — which lost updates under concurrency, drifting the cached
  // counts below the true poll_votes count. The RPC locks the post row and
  // recomputes the counts directly from the authoritative poll_votes in one
  // transaction, so the denormalized counts always match the tally.
  const { data: updated, error: voteErr } = await supabase
    .rpc('apply_poll_vote', {
      p_post_id: id,
      p_user_id: userId,
      p_option_id: option_id,
    })
    .single();

  if (voteErr) return res.status(500).json({ error: sanitizeError(voteErr) });

  return res.json({ post: { ...(updated as object), my_vote_option_id: option_id } });
}
