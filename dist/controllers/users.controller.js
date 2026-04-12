"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSportProfile = exports.getSportProfile = exports.getRatingHistory = exports.getRival = exports.getActivityHeatmap = exports.discoverPlayers = exports.getProfileCompleteness = exports.getBlockedUsers = exports.unblockUser = exports.blockUser = exports.getFollowing = exports.getFollowers = exports.unfollowUser = exports.followUser = exports.updateMe = exports.getUserById = exports.getMe = void 0;
const supabase_1 = require("../utils/supabase");
const subscriptions_controller_1 = require("./subscriptions.controller");
// Public-safe user fields. Never returns password_hash.
const PUBLIC_FIELDS = 'id, phone, name, username, email, city_id, account_type, profile_picture_url, bio, gender, dob, show_dob, link, is_premium, premium_expires_at, coin_balance, is_available, streak_count, referral_code, trial_used, created_at';
// Fire smart engagement notifications lazily from /users/me. Best-effort,
// never throws — failures here must not block the main profile response.
async function runSmartNotifications(userId) {
    try {
        const now = new Date();
        const fifteenMinsMs = 15 * 60 * 1000;
        const in15m = new Date(now.getTime() + fifteenMinsMs).toISOString();
        const nowIso = now.toISOString();
        // 1. Match reminders for matches starting in the next 15 minutes where
        //    the user is a participant and a reminder hasn't been sent yet.
        const { data: parts } = await supabase_1.supabase
            .from('match_participants')
            .select('match_id, match:matches(id, team_a_name, team_b_name, scheduled_at, status)')
            .eq('user_id', userId);
        const soonMatches = (parts || []).filter((p) => {
            const m = p.match;
            if (!m)
                return false;
            if (m.status === 'completed' || m.status === 'cancelled')
                return false;
            if (!m.scheduled_at)
                return false;
            const t = new Date(m.scheduled_at).toISOString();
            return t > nowIso && t <= in15m;
        });
        for (const p of soonMatches) {
            const m = p.match;
            // Have we already inserted a reminder for this user+match? Check notifs.
            const { data: existing } = await supabase_1.supabase
                .from('notifications')
                .select('id')
                .eq('user_id', userId)
                .eq('type', 'match_reminder')
                .contains('data', { matchId: m.id })
                .maybeSingle();
            if (existing)
                continue;
            await supabase_1.supabase.from('notifications').insert({
                user_id: userId,
                type: 'match_reminder',
                title: 'Match reminder',
                body: `\u23F0 ${m.team_a_name} vs ${m.team_b_name} starts in 15 minutes!`,
                data: { matchId: m.id, screen: 'MatchDetail' },
            });
        }
        // 2. Friday evening engagement nudge: if it's Friday 18:00-20:00 local
        //    (we assume IST / UTC+5:30 for the India audience) and the user
        //    hasn't created a match this week, insert a once-per-week nudge.
        const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
        const dayOfWeek = ist.getUTCDay(); // 5 = Friday in IST
        const hourIst = ist.getUTCHours();
        if (dayOfWeek === 5 && hourIst >= 18 && hourIst < 20) {
            // Start of current ISO week (Monday 00:00 IST).
            const weekStart = new Date(ist);
            const diffToMonday = (weekStart.getUTCDay() + 6) % 7;
            weekStart.setUTCDate(weekStart.getUTCDate() - diffToMonday);
            weekStart.setUTCHours(0, 0, 0, 0);
            const weekStartIso = new Date(weekStart.getTime() - 5.5 * 60 * 60 * 1000).toISOString();
            const { data: myMatches } = await supabase_1.supabase
                .from('matches')
                .select('id')
                .eq('created_by', userId)
                .gte('created_at', weekStartIso)
                .limit(1);
            if (!myMatches || myMatches.length === 0) {
                const { data: alreadySent } = await supabase_1.supabase
                    .from('notifications')
                    .select('id')
                    .eq('user_id', userId)
                    .eq('type', 'weekend_nudge')
                    .gte('created_at', weekStartIso)
                    .maybeSingle();
                if (!alreadySent) {
                    await supabase_1.supabase.from('notifications').insert({
                        user_id: userId,
                        type: 'weekend_nudge',
                        title: '\uD83C\uDFC6 Plan your weekend match!',
                        body: 'Create a match and invite your friends before Sunday.',
                        data: { screen: 'Home' },
                    });
                }
            }
        }
    }
    catch {
        // swallow
    }
}
// GET /users/me — self profile with premium lazy expiry check.
// Wired to Fix 1: on every app-startup fetch we reconcile subscription state.
async function getMe(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    await (0, subscriptions_controller_1.checkExpiredSubscriptions)(userId);
    // Fire-and-forget — the profile response shouldn't wait on this.
    void runSmartNotifications(userId);
    const { data, error } = await supabase_1.supabase
        .from('users')
        .select(PUBLIC_FIELDS)
        .eq('id', userId)
        .maybeSingle();
    if (error)
        return res.status(500).json({ error: error.message });
    if (!data)
        return res.status(404).json({ error: 'User not found' });
    // Profile-completion bonus — 10 coins, once per user. Idempotent via
    // coin_events unique key. Requires name + photo + city + at least 1 sport.
    try {
        const hasName = !!data.name;
        const hasPhoto = !!data.profile_picture_url;
        const hasCity = !!data.city_id;
        if (hasName && hasPhoto && hasCity) {
            const { count: sportCount } = await supabase_1.supabase
                .from('user_sports')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId);
            if ((sportCount ?? 0) > 0) {
                const { awardCoins } = await Promise.resolve().then(() => __importStar(require('../utils/coins')));
                void awardCoins(userId, 'complete_profile', 10);
            }
        }
    }
    catch {
        // swallow
    }
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
    'link', 'gender', 'dob', 'show_dob', 'is_available',
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
        .select('id, name, username, profile_picture_url, city_id, is_premium, is_available, streak_count')
        .in('id', matchedIds);
    const userMap = new Map();
    for (const u of users || [])
        userMap.set(u.id, u);
    // Filter by same city if user has one, then rank by availability + rating.
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
            is_available: !!u.is_available,
            streak_count: u.streak_count ?? 0,
            rating: p.rating,
            matches_played: p.matches_played,
            wins: p.wins,
            last_active: p.last_match_at,
        };
    })
        .filter(Boolean);
    // Available players rank first; ties break by rating desc.
    players.sort((a, b) => {
        if (a.is_available !== b.is_available)
            return a.is_available ? -1 : 1;
        return (b.rating ?? 0) - (a.rating ?? 0);
    });
    return res.json({ players, mode: mode || 'singles' });
}
exports.discoverPlayers = discoverPlayers;
// GET /users/:id/activity-heatmap — returns an entry per day for the last
// 84 days. `type` is one of 'none' | 'played' | 'won'. Cheap to compute
// on demand; the frontend caches it per-user.
async function getActivityHeatmap(req, res) {
    const { id } = req.params;
    // 84 days ago in the same timezone as the server.
    const since = new Date();
    since.setDate(since.getDate() - 83);
    since.setHours(0, 0, 0, 0);
    const sinceIso = since.toISOString();
    // Fetch this user's match participations joined with the match row so we
    // can tell who won. Cast team_side to 'A' | 'B' for the winner check.
    const { data, error } = await supabase_1.supabase
        .from('match_participants')
        .select('team_side, match:matches(id, scheduled_at, status, winner_team_id, team_a_id, team_b_id, updated_at)')
        .eq('user_id', id)
        .limit(500);
    if (error)
        return res.status(500).json({ error: error.message });
    const byDay = new Map();
    for (const row of data || []) {
        const match = row.match;
        if (!match)
            continue;
        if (match.status !== 'completed')
            continue;
        const ts = match.updated_at ?? match.scheduled_at;
        if (!ts)
            continue;
        const d = new Date(ts);
        if (d < since)
            continue;
        const key = d.toISOString().slice(0, 10);
        // Winner detection: winner_team_id matches the side's team id.
        const mySideTeamId = row.team_side === 'A' ? match.team_a_id : match.team_b_id;
        const iWon = match.winner_team_id && match.winner_team_id === mySideTeamId;
        // "won" is more interesting than "played", so upgrade but never downgrade.
        if (iWon) {
            byDay.set(key, 'won');
        }
        else if (!byDay.has(key)) {
            byDay.set(key, 'played');
        }
    }
    // Emit an 84-day dense array, oldest first.
    const out = [];
    for (let i = 0; i < 84; i++) {
        const d = new Date(since);
        d.setDate(since.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        out.push({ date: key, type: byDay.get(key) ?? 'none' });
    }
    return res.json({ heatmap: out });
}
exports.getActivityHeatmap = getActivityHeatmap;
// GET /users/:id/rival?sport_id=... — finds a rival player: the user in the
// same sport with the closest higher rating. Searches progressively wider
// scopes (city → state → country) and returns the first match. Returns null
// if the caller is the top player in the wider pool.
async function getRival(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    const sportId = req.query.sport_id;
    if (!sportId)
        return res.status(400).json({ error: 'sport_id is required' });
    // Get the requester's rating + location.
    const { data: myProfile } = await supabase_1.supabase
        .from('user_sport_profiles')
        .select('rating, matches_played')
        .eq('user_id', id)
        .eq('sport_id', sportId)
        .maybeSingle();
    if (!myProfile)
        return res.json({ rival: null });
    const { data: me } = await supabase_1.supabase
        .from('users')
        .select('city_id')
        .eq('id', id)
        .maybeSingle();
    const myCityId = me?.city_id ?? null;
    // Resolve state via cities join for state-level fallback.
    let myStateId = null;
    if (myCityId) {
        const { data: cityRow } = await supabase_1.supabase
            .from('cities')
            .select('state_id, state')
            .eq('id', myCityId)
            .maybeSingle();
        myStateId = cityRow?.state_id ?? cityRow?.state ?? null;
    }
    // Query all candidate profiles with higher rating and sort by delta.
    const { data: higher } = await supabase_1.supabase
        .from('user_sport_profiles')
        .select('user_id, rating, matches_played, wins')
        .eq('sport_id', sportId)
        .gt('rating', myProfile.rating)
        .order('rating', { ascending: true })
        .limit(200);
    if (!higher || higher.length === 0) {
        return res.json({ rival: null });
    }
    const candidateIds = higher.map((h) => h.user_id).filter((uid) => uid !== id);
    if (candidateIds.length === 0)
        return res.json({ rival: null });
    const { data: users } = await supabase_1.supabase
        .from('users')
        .select('id, name, username, profile_picture_url, city_id, is_premium')
        .in('id', candidateIds);
    const userMap = new Map();
    for (const u of users || [])
        userMap.set(u.id, u);
    // Helper: resolve a candidate's state from their city.
    const stateCache = new Map();
    const resolveState = async (cityId) => {
        if (!cityId)
            return null;
        if (stateCache.has(cityId))
            return stateCache.get(cityId) ?? null;
        const { data: cityRow } = await supabase_1.supabase
            .from('cities')
            .select('state_id, state')
            .eq('id', cityId)
            .maybeSingle();
        const s = cityRow?.state_id ?? cityRow?.state ?? null;
        stateCache.set(cityId, s);
        return s;
    };
    // Tiered search: city first, then state, then country-wide. The candidates
    // array is already ordered by rating ascending, so the first match we keep
    // for each tier is the closest-higher rival.
    const pickTier = async (tier) => {
        for (const h of higher) {
            if (h.user_id === id)
                continue;
            const u = userMap.get(h.user_id);
            if (!u)
                continue;
            if (tier === 'city' && myCityId && u.city_id !== myCityId)
                continue;
            if (tier === 'state') {
                if (!myStateId)
                    continue;
                const s = await resolveState(u.city_id);
                if (s !== myStateId)
                    continue;
            }
            return { profile: h, user: u };
        }
        return null;
    };
    const match = (await pickTier('city')) ?? (await pickTier('state')) ?? (await pickTier('country'));
    if (!match)
        return res.json({ rival: null });
    return res.json({
        rival: {
            user_id: match.profile.user_id,
            name: match.user.name,
            username: match.user.username,
            profile_picture_url: match.user.profile_picture_url,
            city_id: match.user.city_id,
            is_premium: !!match.user.is_premium,
            rating: match.profile.rating,
            matches_played: match.profile.matches_played,
            wins: match.profile.wins,
            points_ahead: Math.round((match.profile.rating - myProfile.rating) * 100) / 100,
        },
    });
}
exports.getRival = getRival;
// GET /users/:id/rating-history?sport_id=... — last-10 rating history rows
// for the given user/sport, oldest-first so the chart can render straight
// left→right without client-side reversal.
async function getRatingHistory(req, res) {
    const { id } = req.params;
    const sportId = req.query.sport_id;
    if (!sportId)
        return res.status(400).json({ error: 'sport_id is required' });
    const { data, error } = await supabase_1.supabase
        .from('rating_history')
        .select('old_rating, new_rating, delta, created_at')
        .eq('user_id', id)
        .eq('sport_id', sportId)
        .order('created_at', { ascending: false })
        .limit(10);
    if (error)
        return res.status(500).json({ error: error.message });
    // Oldest → newest.
    const ordered = (data ?? []).reverse();
    return res.json({ history: ordered });
}
exports.getRatingHistory = getRatingHistory;
// GET /users/:id/sport-profile/:sportId — per-sport rating + stats
// Every preference column the frontend can edit. Centralised here so
// getSportProfile and updateSportProfile agree on what's allowed.
const SPORT_PROFILE_PREFS = [
    'batting_style', 'bowling_style', 'role',
    'dominant_hand', 'play_type', 'preferred_position', 'playing_level',
    'preferred_foot', 'position', 'play_style',
    'backhand_type', 'grip_type', 'preferred_side',
    'playing_style', 'stick_type',
];
const SPORT_PROFILE_SELECT = 'rating, matches_played, wins, losses, draws, last_match_at, ' +
    SPORT_PROFILE_PREFS.join(', ');
async function getSportProfile(req, res) {
    const { id, sportId } = req.params;
    const { data: profile } = await supabase_1.supabase
        .from('user_sport_profiles')
        .select(SPORT_PROFILE_SELECT)
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
                cityRank: null,
                globalRank: null,
            },
        });
    }
    // Calculate city + global rank by counting how many players have a
    // strictly higher rating in the same sport. Rank = count + 1.
    let cityRank = null;
    let globalRank = null;
    const p = profile;
    try {
        // Global rank
        const { count: aboveGlobal } = await supabase_1.supabase
            .from('user_sport_profiles')
            .select('id', { count: 'exact', head: true })
            .eq('sport_id', sportId)
            .gt('rating', p.rating);
        globalRank = (aboveGlobal ?? 0) + 1;
        // City rank — need the user's city_id from the users table
        const { data: userRow } = await supabase_1.supabase
            .from('users')
            .select('city_id')
            .eq('id', id)
            .maybeSingle();
        if (userRow?.city_id) {
            const { count: aboveCity } = await supabase_1.supabase
                .from('user_sport_profiles')
                .select('id', { count: 'exact', head: true })
                .eq('sport_id', sportId)
                .gt('rating', p.rating);
            cityRank = (aboveCity ?? 0) + 1;
        }
    }
    catch {
        // Non-critical — return null ranks if calculation fails
    }
    return res.json({ profile: { ...p, cityRank, globalRank } });
}
exports.getSportProfile = getSportProfile;
// PATCH /users/:id/sport-profile/:sportId
// Updates any subset of the per-sport preference columns. Only the owner
// of the profile (id === req.userId) can update. Creates the row if it
// doesn't yet exist so the first-edit flow works.
async function updateSportProfile(req, res) {
    const callerId = req.userId;
    if (!callerId)
        return res.status(401).json({ error: 'Unauthorized' });
    const { id, sportId } = req.params;
    if (id !== callerId)
        return res.status(403).json({ error: 'Can only update your own sport profile' });
    // Whitelist the incoming patch against SPORT_PROFILE_PREFS so arbitrary
    // fields (like rating) can't be overwritten through this endpoint.
    const incoming = req.body ?? {};
    const patch = {};
    for (const key of SPORT_PROFILE_PREFS) {
        if (key in incoming)
            patch[key] = incoming[key];
    }
    if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'No updatable fields provided' });
    }
    // Upsert on (user_id, sport_id). Supabase's upsert needs the full target
    // row, so we look up first and choose insert vs update.
    const { data: existing } = await supabase_1.supabase
        .from('user_sport_profiles')
        .select('id')
        .eq('user_id', id)
        .eq('sport_id', sportId)
        .maybeSingle();
    if (existing) {
        const { error } = await supabase_1.supabase
            .from('user_sport_profiles')
            .update({ ...patch, updated_at: new Date().toISOString() })
            .eq('id', existing.id);
        if (error)
            return res.status(500).json({ error: error.message });
    }
    else {
        const { error } = await supabase_1.supabase
            .from('user_sport_profiles')
            .insert({ user_id: id, sport_id: sportId, ...patch });
        if (error)
            return res.status(500).json({ error: error.message });
    }
    // Return the fresh row so the client can render immediately.
    const { data: profile } = await supabase_1.supabase
        .from('user_sport_profiles')
        .select(SPORT_PROFILE_SELECT)
        .eq('user_id', id)
        .eq('sport_id', sportId)
        .maybeSingle();
    return res.json({ profile });
}
exports.updateSportProfile = updateSportProfile;
//# sourceMappingURL=users.controller.js.map