"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSportProfile = exports.discoverPlayers = exports.getProfileCompleteness = exports.getBlockedUsers = exports.unblockUser = exports.blockUser = exports.getFollowing = exports.getFollowers = exports.unfollowUser = exports.followUser = exports.updateMe = exports.getUserById = exports.getMe = void 0;
const supabase_1 = require("../utils/supabase");
const subscriptions_controller_1 = require("./subscriptions.controller");
// Public-safe user fields. Never returns password_hash.
const PUBLIC_FIELDS = 'id, phone, name, username, email, city_id, account_type, profile_picture_url, bio, gender, dob, show_dob, link, is_premium, premium_expires_at, coin_balance, created_at';
// GET /users/me — self profile with premium lazy expiry check.
// Wired to Fix 1: on every app-startup fetch we reconcile subscription state.
async function getMe(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    await (0, subscriptions_controller_1.checkExpiredSubscriptions)(userId);
    const { data, error } = await supabase_1.supabase
        .from('users')
        .select(PUBLIC_FIELDS)
        .eq('id', userId)
        .maybeSingle();
    if (error)
        return res.status(500).json({ error: error.message });
    if (!data)
        return res.status(404).json({ error: 'User not found' });
    return res.json({ user: data });
}
exports.getMe = getMe;
// GET /users/:id — public profile
async function getUserById(req, res) {
    const { id } = req.params;
    const { data, error } = await supabase_1.supabase
        .from('users')
        .select(PUBLIC_FIELDS)
        .eq('id', id)
        .maybeSingle();
    if (error)
        return res.status(500).json({ error: error.message });
    if (!data)
        return res.status(404).json({ error: 'User not found' });
    // Respect the DOB privacy toggle (PRD 17.5): if the owner hid their DOB,
    // strip it from the public response. Viewing your own profile hits
    // /users/me instead, so we don't need a self-bypass here.
    const safeUser = { ...data };
    if (safeUser.show_dob === false) {
        safeUser.dob = null;
    }
    // Counts (followers/following) — best-effort, never fail the request.
    const [followersRes, followingRes] = await Promise.all([
        supabase_1.supabase.from('follow_relationships').select('id', { count: 'exact', head: true }).eq('following_id', id),
        supabase_1.supabase.from('follow_relationships').select('id', { count: 'exact', head: true }).eq('follower_id', id),
    ]);
    return res.json({
        user: safeUser,
        followers: followersRes.count ?? 0,
        following: followingRes.count ?? 0,
    });
}
exports.getUserById = getUserById;
// PATCH /users/me — update own profile.
// Change #4: NO size limit on profile_picture_url. We accept any URL.
const ALLOWED_FIELDS = [
    'name', 'username', 'email', 'city_id', 'profile_picture_url', 'bio',
    'link', 'gender', 'dob', 'show_dob',
];
const USERNAME_COOLDOWN_DAYS = 30;
async function updateMe(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const patch = {};
    for (const k of ALLOWED_FIELDS) {
        if (k in (req.body || {}))
            patch[k] = req.body[k];
    }
    if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'No updatable fields provided' });
    }
    // Username change: enforce 30-day cooldown and uniqueness
    if ('username' in patch && patch.username) {
        const { data: current } = await supabase_1.supabase
            .from('users')
            .select('username, last_username_changed_at')
            .eq('id', userId)
            .single();
        if (current && patch.username.toLowerCase() !== current.username?.toLowerCase()) {
            // Check cooldown
            if (current.last_username_changed_at) {
                const lastChanged = new Date(current.last_username_changed_at);
                const nextAllowed = new Date(lastChanged.getTime() + USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
                if (new Date() < nextAllowed) {
                    return res.status(400).json({
                        error: `Username can only be changed once every 30 days. Next change available: ${nextAllowed.toISOString().split('T')[0]}`,
                    });
                }
            }
            // Check uniqueness
            const { data: taken } = await supabase_1.supabase
                .from('users')
                .select('id')
                .ilike('username', patch.username)
                .neq('id', userId)
                .maybeSingle();
            if (taken)
                return res.status(409).json({ error: 'Username already taken' });
            patch.last_username_changed_at = new Date().toISOString();
        }
        else {
            // Same username — remove from patch
            delete patch.username;
        }
    }
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase_1.supabase
        .from('users')
        .update(patch)
        .eq('id', userId)
        .select(PUBLIC_FIELDS)
        .single();
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ user: data });
}
exports.updateMe = updateMe;
// POST /users/:id/follow
async function followUser(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const { id: target } = req.params;
    if (target === userId)
        return res.status(400).json({ error: 'Cannot follow yourself' });
    const { error } = await supabase_1.supabase
        .from('follow_relationships')
        .insert({ follower_id: userId, following_id: target });
    if (error && !error.message.includes('duplicate')) {
        return res.status(500).json({ error: error.message });
    }
    return res.json({ success: true });
}
exports.followUser = followUser;
// DELETE /users/:id/follow
async function unfollowUser(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const { id: target } = req.params;
    const { error } = await supabase_1.supabase
        .from('follow_relationships')
        .delete()
        .eq('follower_id', userId)
        .eq('following_id', target);
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ success: true });
}
exports.unfollowUser = unfollowUser;
// GET /users/:id/followers
async function getFollowers(req, res) {
    const { id } = req.params;
    const { data, error } = await supabase_1.supabase
        .from('follow_relationships')
        .select('follower_id, users:follower_id (id, name, profile_picture_url, bio)')
        .eq('following_id', id)
        .order('created_at', { ascending: false });
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ users: (data || []).map((r) => r.users).filter(Boolean) });
}
exports.getFollowers = getFollowers;
// GET /users/:id/following
async function getFollowing(req, res) {
    const { id } = req.params;
    const { data, error } = await supabase_1.supabase
        .from('follow_relationships')
        .select('following_id, users:following_id (id, name, profile_picture_url, bio)')
        .eq('follower_id', id)
        .order('created_at', { ascending: false });
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ users: (data || []).map((r) => r.users).filter(Boolean) });
}
exports.getFollowing = getFollowing;
// POST /users/:id/block
async function blockUser(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const { id: target } = req.params;
    if (target === userId)
        return res.status(400).json({ error: 'Cannot block yourself' });
    // Blocking implicitly unfollows in both directions.
    await supabase_1.supabase
        .from('follow_relationships')
        .delete()
        .or(`and(follower_id.eq.${userId},following_id.eq.${target}),and(follower_id.eq.${target},following_id.eq.${userId})`);
    const { error } = await supabase_1.supabase
        .from('user_blocks')
        .insert({ blocker_id: userId, blocked_id: target });
    if (error && !error.message.includes('duplicate')) {
        return res.status(500).json({ error: error.message });
    }
    return res.json({ success: true });
}
exports.blockUser = blockUser;
// DELETE /users/:id/block
async function unblockUser(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const { id: target } = req.params;
    const { error } = await supabase_1.supabase
        .from('user_blocks')
        .delete()
        .eq('blocker_id', userId)
        .eq('blocked_id', target);
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ success: true });
}
exports.unblockUser = unblockUser;
// GET /users/me/blocked
async function getBlockedUsers(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const { data, error } = await supabase_1.supabase
        .from('user_blocks')
        .select('blocked_id, users:blocked_id (id, name, profile_picture_url)')
        .eq('blocker_id', userId)
        .order('created_at', { ascending: false });
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ users: (data || []).map((r) => r.users).filter(Boolean) });
}
exports.getBlockedUsers = getBlockedUsers;
// GET /users/me/profile-completeness
// Simple % score based on filled-in fields. Tweak weights freely.
async function getProfileCompleteness(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const { data: user, error } = await supabase_1.supabase
        .from('users')
        .select('name, email, city_id, profile_picture_url, bio')
        .eq('id', userId)
        .maybeSingle();
    if (error)
        return res.status(500).json({ error: error.message });
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    const checks = [
        { field: 'name', filled: !!user.name, weight: 20 },
        { field: 'email', filled: !!user.email, weight: 15 },
        { field: 'city_id', filled: !!user.city_id, weight: 15 },
        { field: 'profile_picture_url', filled: !!user.profile_picture_url, weight: 25 },
        { field: 'bio', filled: !!user.bio, weight: 10 },
    ];
    // Sport count contributes the remaining 15 points.
    const { count: sportCountRaw } = await supabase_1.supabase
        .from('user_sports')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
    const sportCount = sportCountRaw ?? 0;
    const sportPoints = Math.min(15, sportCount * 5);
    const filledPoints = checks.reduce((sum, c) => sum + (c.filled ? c.weight : 0), 0);
    const percent = Math.min(100, filledPoints + sportPoints);
    const missing = checks.filter((c) => !c.filled).map((c) => c.field);
    if (sportCount === 0)
        missing.push('sports');
    return res.json({ percent, missing });
}
exports.getProfileCompleteness = getProfileCompleteness;
// GET /users/discover?sport_id=&mode=singles|doubles
// Returns players within ±15% rating, same city, not blocked, sorted by last_active.
async function discoverPlayers(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const { sport_id, mode } = req.query;
    if (!sport_id)
        return res.status(400).json({ error: 'sport_id is required' });
    // Get requesting user's city and sport profile
    const { data: me } = await supabase_1.supabase
        .from('users')
        .select('city_id')
        .eq('id', userId)
        .maybeSingle();
    if (!me)
        return res.status(404).json({ error: 'User not found' });
    const { data: myProfile } = await supabase_1.supabase
        .from('user_sport_profiles')
        .select('rating')
        .eq('user_id', userId)
        .eq('sport_id', sport_id)
        .maybeSingle();
    const myRating = myProfile?.rating ?? 1200;
    const ratingLow = myRating * 0.85;
    const ratingHigh = myRating * 1.15;
    // Get blocked user IDs (in both directions)
    const { data: blocksOut } = await supabase_1.supabase
        .from('user_blocks')
        .select('blocked_id')
        .eq('blocker_id', userId);
    const { data: blocksIn } = await supabase_1.supabase
        .from('user_blocks')
        .select('blocker_id')
        .eq('blocked_id', userId);
    const blockedIds = new Set();
    blockedIds.add(userId);
    for (const b of blocksOut || [])
        blockedIds.add(b.blocked_id);
    for (const b of blocksIn || [])
        blockedIds.add(b.blocker_id);
    // Query user_sport_profiles within rating range for this sport
    let query = supabase_1.supabase
        .from('user_sport_profiles')
        .select('user_id, rating, matches_played, wins, last_match_at')
        .eq('sport_id', sport_id)
        .gte('rating', ratingLow)
        .lte('rating', ratingHigh)
        .order('last_match_at', { ascending: false, nullsFirst: false })
        .limit(50);
    const { data: profiles, error } = await query;
    if (error)
        return res.status(500).json({ error: error.message });
    // Filter out blocked users
    const filteredProfiles = (profiles || []).filter((p) => !blockedIds.has(p.user_id));
    if (filteredProfiles.length === 0)
        return res.json({ players: [] });
    // Fetch user details for matched profiles
    const matchedIds = filteredProfiles.map((p) => p.user_id);
    const { data: users } = await supabase_1.supabase
        .from('users')
        .select('id, name, username, profile_picture_url, city_id, is_premium')
        .in('id', matchedIds);
    const userMap = new Map();
    for (const u of users || [])
        userMap.set(u.id, u);
    // Filter by same city if user has one
    const players = filteredProfiles
        .map((p) => {
        const u = userMap.get(p.user_id);
        if (!u)
            return null;
        if (me.city_id && u.city_id && u.city_id !== me.city_id)
            return null;
        return {
            user_id: p.user_id,
            name: u.name,
            username: u.username,
            profile_picture_url: u.profile_picture_url,
            city_id: u.city_id,
            is_premium: u.is_premium,
            rating: p.rating,
            matches_played: p.matches_played,
            wins: p.wins,
            last_active: p.last_match_at,
        };
    })
        .filter(Boolean);
    return res.json({ players, mode: mode || 'singles' });
}
exports.discoverPlayers = discoverPlayers;
// GET /users/:id/sport-profile/:sportId — per-sport rating + stats
async function getSportProfile(req, res) {
    const { id, sportId } = req.params;
    const { data: profile } = await supabase_1.supabase
        .from('user_sport_profiles')
        .select('rating, matches_played, wins, losses, draws, last_match_at')
        .eq('user_id', id)
        .eq('sport_id', sportId)
        .maybeSingle();
    if (!profile) {
        return res.json({
            profile: {
                rating: 1200,
                matches_played: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                last_match_at: null,
            },
        });
    }
    return res.json({ profile });
}
exports.getSportProfile = getSportProfile;
//# sourceMappingURL=users.controller.js.map