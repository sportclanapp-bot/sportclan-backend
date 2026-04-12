"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.triggerWeeklyDigest = exports.triggerReEngagement = exports.checkRatingMilestone = exports.triggerSmartMatchNotifications = exports.getNearbyMatches = exports.getPlayerOfWeek = exports.getSeasonRecap = exports.publishScheduledPosts = exports.getTournamentAnalytics = void 0;
const supabase_1 = require("../utils/supabase");
const response_1 = require("../utils/response");
const notify_1 = require("../utils/notify");
// ────────────────────────────────────────────────────────────────────────────
// FEATURE 20 — Tournament Analytics
// GET /tournaments/:id/analytics
// ────────────────────────────────────────────────────────────────────────────
async function getTournamentAnalytics(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { id } = req.params;
        const { data: t } = await supabase_1.supabase.from('tournaments').select('created_by').eq('id', id).maybeSingle();
        if (!t)
            return res.status(404).json({ error: 'Tournament not found' });
        if (t.created_by !== userId)
            return res.status(403).json({ error: 'Only the organiser can view analytics' });
        const [entriesRes, matchesRes] = await Promise.all([
            supabase_1.supabase.from('tournament_entries').select('id', { count: 'exact', head: true }).eq('tournament_id', id),
            supabase_1.supabase.from('matches').select('id, status').eq('tournament_id', id),
        ]);
        const matches = matchesRes.data ?? [];
        const completed = matches.filter((m) => m.status === 'completed').length;
        const pending = matches.filter((m) => m.status === 'scheduled' || m.status === 'live').length;
        const total = matches.length || 1;
        return res.json({
            registrations_count: entriesRes.count ?? 0,
            matches_completed: completed,
            matches_pending: pending,
            completion_percentage: Math.round((completed / total) * 100),
        });
    }
    catch {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.getTournamentAnalytics = getTournamentAnalytics;
// ────────────────────────────────────────────────────────────────────────────
// FEATURE 18 — Publish Scheduled Posts
// GET /dev/publish-scheduled-posts
// ────────────────────────────────────────────────────────────────────────────
async function publishScheduledPosts(req, res) {
    try {
        const now = new Date().toISOString();
        const { data, error } = await supabase_1.supabase
            .from('community_posts')
            .update({ scheduled_at: null })
            .lte('scheduled_at', now)
            .not('scheduled_at', 'is', null)
            .select('id');
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        return res.json({ published: data?.length ?? 0 });
    }
    catch {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.publishScheduledPosts = publishScheduledPosts;
// ────────────────────────────────────────────────────────────────────────────
// FEATURE 1 — Season Recap
// GET /users/:id/season-recap
// ────────────────────────────────────────────────────────────────────────────
async function getSeasonRecap(req, res) {
    const { id } = req.params;
    try {
        // Current season = last 90 days
        const since = new Date(Date.now() - 90 * 86400000).toISOString();
        const [profilesRes, matchesRes, giftsRecvRes, giftsSentRes, followsRes] = await Promise.all([
            supabase_1.supabase.from('user_sport_profiles')
                .select('sport_id, rating, matches_played, wins, losses, draws')
                .eq('user_id', id),
            supabase_1.supabase.from('match_participants')
                .select('match_id, team_side, match:matches!inner(id, sport_id, status, winner_team_id, score_summary, created_at)')
                .eq('user_id', id)
                .gte('match.created_at', since),
            supabase_1.supabase.from('gift_transactions')
                .select('id', { count: 'exact', head: true })
                .eq('receiver_id', id)
                .gte('created_at', since),
            supabase_1.supabase.from('gift_transactions')
                .select('id', { count: 'exact', head: true })
                .eq('sender_id', id)
                .gte('created_at', since),
            supabase_1.supabase.from('follow_relationships')
                .select('id', { count: 'exact', head: true })
                .eq('following_id', id)
                .gte('created_at', since),
        ]);
        const profiles = profilesRes.data ?? [];
        const matches = (matchesRes.data ?? []).map((p) => p.match).filter(Boolean);
        const completed = matches.filter((m) => m.status === 'completed');
        // Best sport = highest rating
        const best = profiles.reduce((a, b) => (b.rating ?? 0) > (a?.rating ?? 0) ? b : a, profiles[0] ?? null);
        const totalWins = profiles.reduce((s, p) => s + (p.wins ?? 0), 0);
        const totalLosses = profiles.reduce((s, p) => s + (p.losses ?? 0), 0);
        const totalDraws = profiles.reduce((s, p) => s + (p.draws ?? 0), 0);
        return res.json({
            recap: {
                totalMatches: completed.length,
                wins: totalWins,
                losses: totalLosses,
                draws: totalDraws,
                bestSportId: best?.sport_id ?? null,
                bestRating: best?.rating ?? 0,
                giftsReceived: giftsRecvRes.count ?? 0,
                giftsGiven: giftsSentRes.count ?? 0,
                followersGained: followsRes.count ?? 0,
                sportProfiles: profiles,
            },
        });
    }
    catch {
        return res.status(500).json({ error: 'Could not generate season recap' });
    }
}
exports.getSeasonRecap = getSeasonRecap;
// ────────────────────────────────────────────────────────────────────────────
// FEATURE 3 — Player of the Week
// GET /leaderboard/player-of-week
// ────────────────────────────────────────────────────────────────────────────
let potwCache = null;
const POTW_TTL = 24 * 60 * 60 * 1000; // 24h
async function getPlayerOfWeek(req, res) {
    if (potwCache && Date.now() - potwCache.at < POTW_TTL) {
        return res.json(potwCache.data);
    }
    try {
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        // Get profiles with recent activity
        const { data: profiles } = await supabase_1.supabase
            .from('user_sport_profiles')
            .select('user_id, sport_id, rating, wins, matches_played, last_match_at')
            .gte('last_match_at', weekAgo)
            .order('rating', { ascending: false })
            .limit(100);
        if (!profiles || profiles.length === 0) {
            return res.json({ players: [] });
        }
        // Score = wins×3 + matches_played×1 + rating×0.01
        const scored = profiles.map((p) => ({
            ...p,
            score: (p.wins ?? 0) * 3 + (p.matches_played ?? 0) * 1 + (p.rating ?? 0) * 0.01,
        }));
        scored.sort((a, b) => b.score - a.score);
        // Top per sport
        const seen = new Set();
        const top = [];
        for (const p of scored) {
            if (seen.has(p.sport_id))
                continue;
            seen.add(p.sport_id);
            top.push(p);
        }
        // Enrich with user info
        const userIds = top.map((p) => p.user_id);
        const { data: users } = await supabase_1.supabase
            .from('users')
            .select('id, name, username, profile_picture_url, is_premium')
            .in('id', userIds);
        const userMap = new Map((users ?? []).map((u) => [u.id, u]));
        const result = {
            players: top.slice(0, 11).map((p) => ({
                user: userMap.get(p.user_id) ?? null,
                sport_id: p.sport_id,
                rating: p.rating,
                wins: p.wins,
                matches_played: p.matches_played,
                score: Math.round(p.score),
            })),
        };
        potwCache = { data: result, at: Date.now() };
        return res.json(result);
    }
    catch {
        return res.status(500).json({ error: 'Could not compute player of the week' });
    }
}
exports.getPlayerOfWeek = getPlayerOfWeek;
// ────────────────────────────────────────────────────────────────────────────
// FEATURE 6 — Nearby Matches
// GET /matches/nearby?city_id=X
// ────────────────────────────────────────────────────────────────────────────
async function getNearbyMatches(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { city_id } = req.query;
        // Resolve city: param or user's own city
        let cityId = city_id;
        if (!cityId) {
            const { data: u } = await supabase_1.supabase.from('users').select('city_id').eq('id', userId).maybeSingle();
            cityId = u?.city_id ?? undefined;
        }
        if (!cityId)
            return res.json({ today: [], thisWeek: [], thisMonth: [] });
        const now = new Date();
        const endOfToday = new Date(now);
        endOfToday.setHours(23, 59, 59, 999);
        const endOfWeek = new Date(now.getTime() + 7 * 86400000);
        const endOfMonth = new Date(now.getTime() + 30 * 86400000);
        const { data: matches, error } = await supabase_1.supabase
            .from('matches')
            .select('id, sport_id, team_a_name, team_b_name, scheduled_at, venue, status, is_open, players_needed')
            .eq('city_id', cityId)
            .in('status', ['scheduled', 'live'])
            .order('scheduled_at', { ascending: true })
            .limit(50);
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        const all = matches ?? [];
        const today = all.filter((m) => m.scheduled_at && new Date(m.scheduled_at) <= endOfToday);
        const thisWeek = all.filter((m) => m.scheduled_at && new Date(m.scheduled_at) > endOfToday && new Date(m.scheduled_at) <= endOfWeek);
        const thisMonth = all.filter((m) => m.scheduled_at && new Date(m.scheduled_at) > endOfWeek && new Date(m.scheduled_at) <= endOfMonth);
        return res.json({ today, thisWeek, thisMonth });
    }
    catch {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.getNearbyMatches = getNearbyMatches;
// ────────────────────────────────────────────────────────────────────────────
// FEATURE 9 — Smart Match Notification
// GET /dev/trigger-smart-match-notifications
// ────────────────────────────────────────────────────────────────────────────
async function triggerSmartMatchNotifications(req, res) {
    try {
        const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today.getTime() + 86400000);
        // Users inactive for 3+ days
        const { data: inactiveUsers } = await supabase_1.supabase
            .from('users')
            .select('id, city_id, name')
            .lt('last_active_at', threeDaysAgo)
            .limit(100);
        let sent = 0;
        for (const user of inactiveUsers ?? []) {
            if (!user.city_id)
                continue;
            // Find open matches in their city today
            const { data: openMatches } = await supabase_1.supabase
                .from('matches')
                .select('id, team_a_name, venue, sport_id')
                .eq('city_id', user.city_id)
                .eq('is_open', true)
                .gte('scheduled_at', today.toISOString())
                .lt('scheduled_at', tomorrow.toISOString())
                .limit(1);
            if (openMatches && openMatches.length > 0) {
                const m = openMatches[0];
                await supabase_1.supabase.from('notifications').insert({
                    user_id: user.id,
                    type: 'smart_match',
                    title: 'Match near you today!',
                    body: `🎮 ${m.team_a_name} is looking for players at ${m.venue ?? 'a venue nearby'}`,
                    data: { matchId: m.id, screen: 'MatchDetail' },
                });
                sent++;
            }
        }
        return res.json({ success: true, sent });
    }
    catch {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.triggerSmartMatchNotifications = triggerSmartMatchNotifications;
// ────────────────────────────────────────────────────────────────────────────
// FEATURE 10 — Rating Milestone Check
// Called after ELO update in completeMatch. Checks if a user crossed a
// milestone boundary and fires a special notification.
// ────────────────────────────────────────────────────────────────────────────
const MILESTONES = [1000, 1100, 1200, 1300, 1400, 1500, 1800];
async function checkRatingMilestone(userId, sportId, oldRating, newRating) {
    for (const m of MILESTONES) {
        if (oldRating < m && newRating >= m) {
            // Lookup sport name for the message
            const { data: sport } = await supabase_1.supabase
                .from('sports')
                .select('name')
                .eq('id', sportId)
                .maybeSingle();
            const sportName = sport?.name ?? 'your sport';
            await supabase_1.supabase.from('notifications').insert({
                user_id: userId,
                type: 'rating_milestone',
                title: `Rating milestone! 🎉`,
                body: `You crossed ${m} rating in ${sportName}! Amazing achievement!`,
                data: { milestone: m, sportId, screen: 'SportProfile' },
            });
            try {
                await (0, notify_1.notifyUser)({ userId, type: 'rating_milestone', title: 'Rating milestone!', body: `🎉 You crossed ${m} rating in ${sportName}!` });
            }
            catch { /* best effort */ }
            break; // only one milestone per update
        }
    }
}
exports.checkRatingMilestone = checkRatingMilestone;
// ────────────────────────────────────────────────────────────────────────────
// FEATURE 11 — Inactivity Re-engagement
// GET /dev/trigger-reengagement
// ────────────────────────────────────────────────────────────────────────────
async function triggerReEngagement(req, res) {
    try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const { data: dormant } = await supabase_1.supabase
            .from('users')
            .select('id, name, city_id')
            .lt('last_active_at', sevenDaysAgo)
            .limit(200);
        let sent = 0;
        for (const user of dormant ?? []) {
            // Check for unread messages
            const { count: unread } = await supabase_1.supabase
                .from('notifications')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', user.id)
                .eq('read', false);
            // Check new followers
            const { count: newFollowers } = await supabase_1.supabase
                .from('follow_relationships')
                .select('id', { count: 'exact', head: true })
                .eq('following_id', user.id)
                .gte('created_at', sevenDaysAgo);
            let body;
            if ((unread ?? 0) > 0) {
                body = `You have ${unread} unread notifications in SportClan`;
            }
            else if ((newFollowers ?? 0) > 0) {
                body = `${newFollowers} players followed you while you were away!`;
            }
            else {
                body = `Your SportClan clan misses you! 🏆 See what's happening`;
            }
            await supabase_1.supabase.from('notifications').insert({
                user_id: user.id,
                type: 'reengagement',
                title: 'We miss you!',
                body,
                data: { screen: 'HomeMain' },
            });
            try {
                await (0, notify_1.notifyUser)({ userId: user.id, type: 'reengagement', title: 'We miss you!', body });
            }
            catch { /* best effort */ }
            sent++;
        }
        return res.json({ success: true, sent });
    }
    catch {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.triggerReEngagement = triggerReEngagement;
// ────────────────────────────────────────────────────────────────────────────
// FEATURE 2 — Weekly Digest
// GET /dev/trigger-weekly-digest
// ────────────────────────────────────────────────────────────────────────────
async function triggerWeeklyDigest(req, res) {
    try {
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
        // Active users = logged in within 30 days
        const { data: activeUsers } = await supabase_1.supabase
            .from('users')
            .select('id, name')
            .gte('last_active_at', monthAgo)
            .limit(500);
        let sent = 0;
        for (const user of activeUsers ?? []) {
            const [followsRes, matchesRes] = await Promise.all([
                supabase_1.supabase.from('follow_relationships')
                    .select('id', { count: 'exact', head: true })
                    .eq('following_id', user.id)
                    .gte('created_at', weekAgo),
                supabase_1.supabase.from('match_participants')
                    .select('match_id', { count: 'exact', head: true })
                    .eq('user_id', user.id),
            ]);
            const newFollowers = followsRes.count ?? 0;
            const matchesPlayed = matchesRes.count ?? 0;
            if (newFollowers === 0 && matchesPlayed === 0)
                continue;
            const body = `📊 Your week: +${newFollowers} followers, ${matchesPlayed} matches played`;
            await supabase_1.supabase.from('notifications').insert({
                user_id: user.id,
                type: 'weekly_digest',
                title: 'Your weekly digest',
                body,
                data: { followers: newFollowers, matches: matchesPlayed },
            });
            try {
                await (0, notify_1.notifyUser)({ userId: user.id, type: 'weekly_digest', title: 'Your weekly digest', body });
            }
            catch { /* best effort */ }
            sent++;
        }
        return res.json({ success: true, sent });
    }
    catch {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.triggerWeeklyDigest = triggerWeeklyDigest;
//# sourceMappingURL=features.controller.js.map