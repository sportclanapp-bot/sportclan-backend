"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchMentions = exports.checkLiked = exports.getMyPostCount = exports.reportContent = exports.reactToComment = exports.deleteComment = exports.createComment = exports.listComments = exports.unlikePost = exports.likePost = exports.closePost = exports.deletePost = exports.updatePost = exports.createPost = exports.getPost = exports.listPosts = void 0;
const supabase_1 = require("../utils/supabase");
// ─── Basic profanity word list ───────────────────────────────────────────────
const PROFANITY_LIST = [
    'fuck', 'shit', 'ass', 'bitch', 'damn', 'crap', 'dick', 'bastard',
    'piss', 'slut', 'whore', 'cunt', 'nigger', 'faggot', 'retard',
    'madarchod', 'bhenchod', 'chutiya', 'gaandu', 'randi', 'harami',
];
function detectProfanity(text) {
    const lower = text.toLowerCase();
    return PROFANITY_LIST.filter((w) => lower.includes(w));
}
// ─── LIST POSTS (feed) ──────────────────────────────────────────────────────
async function listPosts(req, res) {
    const { sport_id, city_id, post_type, author_id, cursor, limit = '20' } = req.query;
    const pageSize = Math.min(parseInt(limit, 10) || 20, 50);
    let query = supabase_1.supabase
        .from('community_posts')
        .select(`
      *,
      author:users!author_id(id, full_name, username, profile_picture_url, is_premium),
      author_types:user_account_types!inner(account_type),
      sport:sports!sport_id(id, name, emoji),
      city:cities!city_id(id, name)
    `)
        .eq('is_closed', false)
        .order('created_at', { ascending: false })
        .limit(pageSize);
    if (sport_id)
        query = query.eq('sport_id', sport_id);
    if (city_id)
        query = query.eq('city_id', city_id);
    if (post_type)
        query = query.eq('post_type', post_type);
    if (author_id)
        query = query.eq('author_id', author_id);
    if (cursor)
        query = query.lt('created_at', cursor);
    // Fix: author_types inner join requires author_id match
    // We actually need a different approach — join on author_id
    const { data, error } = await supabase_1.supabase
        .from('community_posts')
        .select(`
      *,
      author:users!author_id(id, full_name, username, profile_picture_url, is_premium),
      sport:sports!sport_id(id, name, emoji),
      city:cities!city_id(id, name)
    `)
        .eq('is_closed', false)
        .order('created_at', { ascending: false })
        .limit(pageSize);
    // Re-apply filters on the cleaner query
    let q = supabase_1.supabase
        .from('community_posts')
        .select(`
      *,
      author:users!author_id(id, full_name, username, profile_picture_url, is_premium),
      sport:sports!sport_id(id, name, emoji),
      city:cities!city_id(id, name)
    `)
        .order('created_at', { ascending: false })
        .limit(pageSize);
    if (sport_id)
        q = q.eq('sport_id', sport_id);
    if (city_id)
        q = q.eq('city_id', city_id);
    if (post_type)
        q = q.eq('post_type', post_type);
    if (author_id)
        q = q.eq('author_id', author_id);
    if (cursor)
        q = q.lt('created_at', cursor);
    const result = await q;
    if (result.error)
        return res.status(500).json({ error: result.error.message });
    const items = result.data || [];
    return res.json({
        items,
        nextCursor: items.length === pageSize ? items[items.length - 1]?.created_at : null,
        hasMore: items.length === pageSize,
    });
}
exports.listPosts = listPosts;
// ─── GET SINGLE POST ────────────────────────────────────────────────────────
async function getPost(req, res) {
    const { id } = req.params;
    const { data, error } = await supabase_1.supabase
        .from('community_posts')
        .select(`
      *,
      author:users!author_id(id, full_name, username, profile_picture_url, is_premium),
      sport:sports!sport_id(id, name, emoji),
      city:cities!city_id(id, name)
    `)
        .eq('id', id)
        .single();
    if (error)
        return res.status(404).json({ error: 'Post not found' });
    return res.json({ data });
}
exports.getPost = getPost;
// ─── CREATE POST ────────────────────────────────────────────────────────────
async function createPost(req, res) {
    const userId = req.userId;
    const { content, image_url, link_url, sport_id, city_id, post_type, mentions } = req.body;
    if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: 'Content is required' });
    }
    // Profanity check
    const detected = detectProfanity(content);
    if (detected.length > 0) {
        return res.status(400).json({
            error: 'PROFANITY_DETECTED',
            detected_words: detected,
        });
    }
    // Check premium for image posts
    if (image_url) {
        const { data: user } = await supabase_1.supabase
            .from('users')
            .select('is_premium')
            .eq('id', userId)
            .single();
        if (!user?.is_premium) {
            return res.status(403).json({ error: 'IMAGE_POSTS_PREMIUM' });
        }
    }
    // Check 5 posts/month limit for free users
    const { data: user } = await supabase_1.supabase
        .from('users')
        .select('is_premium')
        .eq('id', userId)
        .single();
    if (!user?.is_premium) {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        const { count } = await supabase_1.supabase
            .from('community_posts')
            .select('id', { count: 'exact', head: true })
            .eq('author_id', userId)
            .gte('created_at', startOfMonth.toISOString());
        if ((count ?? 0) >= 5) {
            return res.status(403).json({ error: 'POST_LIMIT_REACHED' });
        }
    }
    const { data, error } = await supabase_1.supabase
        .from('community_posts')
        .insert({
        author_id: userId,
        content: content.trim(),
        image_url: image_url || null,
        link_url: link_url || null,
        sport_id: sport_id || null,
        city_id: city_id || null,
        post_type: post_type || 'Player',
        mentions: mentions || [],
    })
        .select()
        .single();
    if (error)
        return res.status(500).json({ error: error.message });
    return res.status(201).json({ data });
}
exports.createPost = createPost;
// ─── UPDATE POST ────────────────────────────────────────────────────────────
async function updatePost(req, res) {
    const userId = req.userId;
    const { id } = req.params;
    const { content, sport_id, city_id, post_type, link_url } = req.body;
    if (content) {
        const detected = detectProfanity(content);
        if (detected.length > 0) {
            return res.status(400).json({ error: 'PROFANITY_DETECTED', detected_words: detected });
        }
    }
    const { data, error } = await supabase_1.supabase
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
    if (error)
        return res.status(404).json({ error: 'Post not found or not yours' });
    return res.json({ data });
}
exports.updatePost = updatePost;
// ─── DELETE POST ────────────────────────────────────────────────────────────
async function deletePost(req, res) {
    const userId = req.userId;
    const { id } = req.params;
    const { error } = await supabase_1.supabase
        .from('community_posts')
        .delete()
        .eq('id', id)
        .eq('author_id', userId);
    if (error)
        return res.status(404).json({ error: 'Post not found or not yours' });
    return res.json({ success: true });
}
exports.deletePost = deletePost;
// ─── CLOSE POST ─────────────────────────────────────────────────────────────
async function closePost(req, res) {
    const userId = req.userId;
    const { id } = req.params;
    const { data, error } = await supabase_1.supabase
        .from('community_posts')
        .update({ is_closed: true, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('author_id', userId)
        .select()
        .single();
    if (error)
        return res.status(404).json({ error: 'Post not found or not yours' });
    return res.json({ data });
}
exports.closePost = closePost;
// ─── LIKE / UNLIKE ──────────────────────────────────────────────────────────
async function likePost(req, res) {
    const userId = req.userId;
    const { id } = req.params;
    const { error } = await supabase_1.supabase
        .from('post_likes')
        .insert({ post_id: id, user_id: userId });
    if (error?.code === '23505')
        return res.json({ liked: true }); // already liked
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ liked: true });
}
exports.likePost = likePost;
async function unlikePost(req, res) {
    const userId = req.userId;
    const { id } = req.params;
    await supabase_1.supabase
        .from('post_likes')
        .delete()
        .eq('post_id', id)
        .eq('user_id', userId);
    return res.json({ liked: false });
}
exports.unlikePost = unlikePost;
// ─── COMMENTS ───────────────────────────────────────────────────────────────
async function listComments(req, res) {
    const { id } = req.params;
    const { data, error } = await supabase_1.supabase
        .from('post_comments')
        .select(`
      *,
      author:users!author_id(id, full_name, username, profile_picture_url, is_premium)
    `)
        .eq('post_id', id)
        .order('created_at', { ascending: true });
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ data: data || [] });
}
exports.listComments = listComments;
async function createComment(req, res) {
    const userId = req.userId;
    const { id } = req.params;
    const { content, parent_id, mentions } = req.body;
    if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: 'Content is required' });
    }
    const detected = detectProfanity(content);
    if (detected.length > 0) {
        return res.status(400).json({ error: 'PROFANITY_DETECTED', detected_words: detected });
    }
    const { data, error } = await supabase_1.supabase
        .from('post_comments')
        .insert({
        post_id: id,
        author_id: userId,
        parent_id: parent_id || null,
        content: content.trim(),
        mentions: mentions || [],
    })
        .select(`
      *,
      author:users!author_id(id, full_name, username, profile_picture_url, is_premium)
    `)
        .single();
    if (error)
        return res.status(500).json({ error: error.message });
    return res.status(201).json({ data });
}
exports.createComment = createComment;
async function deleteComment(req, res) {
    const userId = req.userId;
    const { commentId } = req.params;
    const { error } = await supabase_1.supabase
        .from('post_comments')
        .delete()
        .eq('id', commentId)
        .eq('author_id', userId);
    if (error)
        return res.status(404).json({ error: 'Comment not found or not yours' });
    return res.json({ success: true });
}
exports.deleteComment = deleteComment;
async function reactToComment(req, res) {
    const userId = req.userId;
    const { commentId } = req.params;
    const { emoji } = req.body;
    const validEmojis = ['❤️', '😂', '😮', '😢', '👏', '🔥'];
    if (!validEmojis.includes(emoji)) {
        return res.status(400).json({ error: 'Invalid emoji reaction' });
    }
    // Get current reactions
    const { data: comment } = await supabase_1.supabase
        .from('post_comments')
        .select('reactions')
        .eq('id', commentId)
        .single();
    if (!comment)
        return res.status(404).json({ error: 'Comment not found' });
    const reactions = comment.reactions || {};
    const users = reactions[emoji] || [];
    if (users.includes(userId)) {
        reactions[emoji] = users.filter((u) => u !== userId);
        if (reactions[emoji].length === 0)
            delete reactions[emoji];
    }
    else {
        reactions[emoji] = [...users, userId];
    }
    const { error } = await supabase_1.supabase
        .from('post_comments')
        .update({ reactions })
        .eq('id', commentId);
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ reactions });
}
exports.reactToComment = reactToComment;
// ─── REPORT ─────────────────────────────────────────────────────────────────
async function reportContent(req, res) {
    const userId = req.userId;
    const { comment_id, post_id, reason, details } = req.body;
    if (!reason)
        return res.status(400).json({ error: 'Reason is required' });
    const { data, error } = await supabase_1.supabase
        .from('comment_reports')
        .insert({
        comment_id: comment_id || null,
        post_id: post_id || null,
        reporter_id: userId,
        reason,
        details: details || null,
    })
        .select()
        .single();
    if (error)
        return res.status(500).json({ error: error.message });
    return res.status(201).json({ data });
}
exports.reportContent = reportContent;
// ─── MY POST COUNT THIS MONTH ───────────────────────────────────────────────
async function getMyPostCount(req, res) {
    const userId = req.userId;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const { count } = await supabase_1.supabase
        .from('community_posts')
        .select('id', { count: 'exact', head: true })
        .eq('author_id', userId)
        .gte('created_at', startOfMonth.toISOString());
    return res.json({ count: count ?? 0, limit: 5 });
}
exports.getMyPostCount = getMyPostCount;
// ─── CHECK IF USER LIKED ────────────────────────────────────────────────────
async function checkLiked(req, res) {
    const userId = req.userId;
    const { id } = req.params;
    const { data } = await supabase_1.supabase
        .from('post_likes')
        .select('id')
        .eq('post_id', id)
        .eq('user_id', userId)
        .maybeSingle();
    return res.json({ liked: !!data });
}
exports.checkLiked = checkLiked;
// ─── MENTION SEARCH ─────────────────────────────────────────────────────────
async function searchMentions(req, res) {
    const { q } = req.query;
    if (!q || q.length < 1)
        return res.json({ data: [] });
    const { data, error } = await supabase_1.supabase
        .from('users')
        .select('id, full_name, username, profile_picture_url, is_premium')
        .or(`username.ilike.%${q}%,full_name.ilike.%${q}%`)
        .limit(10);
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ data: data || [] });
}
exports.searchMentions = searchMentions;
//# sourceMappingURL=community.controller.js.map