"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateBadges = exports.getUserBadges = void 0;
const supabase_1 = require("../utils/supabase");
// GET /users/:id/badges — list badges for a user
async function getUserBadges(req, res) {
    const { id } = req.params;
    const { data, error } = await supabase_1.supabase
        .from('user_badges')
        .select(`
      id,
      awarded_at,
      badge:badge_id (id, slug, name, description, emoji, category)
    `)
        .eq('user_id', id)
        .order('awarded_at', { ascending: false });
    if (error)
        return res.status(500).json({ error: error.message });
    // Also fetch all badges so frontend can show locked vs unlocked
    const { data: allBadges } = await supabase_1.supabase
        .from('badges')
        .select('id, slug, name, description, emoji, category, threshold')
        .order('category')
        .order('threshold');
    const earnedIds = new Set((data || []).map((ub) => ub.badge?.id).filter(Boolean));
    const badges = (allBadges || []).map((b) => ({
        ...b,
        earned: earnedIds.has(b.id),
        awarded_at: (data || []).find((ub) => ub.badge?.id === b.id)?.awarded_at ?? null,
    }));
    return res.json({ badges });
}
exports.getUserBadges = getUserBadges;
// POST /badges/evaluate/:userId — evaluate and award any new badges
async function evaluateBadges(req, res) {
    const userId = req.params.userId;
    // Fetch all badge definitions
    const { data: allBadges, error: badgesErr } = await supabase_1.supabase
        .from('badges')
        .select('id, slug, category, threshold');
    if (badgesErr)
        return res.status(500).json({ error: badgesErr.message });
    // Fetch already-earned badges
    const { data: earned } = await supabase_1.supabase
        .from('user_badges')
        .select('badge_id')
        .eq('user_id', userId);
    const earnedIds = new Set((earned || []).map((e) => e.badge_id));
    // Gather user stats
    const { data: sportProfiles } = await supabase_1.supabase
        .from('user_sport_profiles')
        .select('matches_played, wins')
        .eq('user_id', userId);
    const totalMatches = (sportProfiles || []).reduce((s, p) => s + p.matches_played, 0);
    const totalWins = (sportProfiles || []).reduce((s, p) => s + p.wins, 0);
    const { count: postCount } = await supabase_1.supabase
        .from('community_posts')
        .select('id', { count: 'exact', head: true })
        .eq('author_id', userId);
    // Evaluate each badge
    const newAwards = [];
    for (const badge of allBadges || []) {
        if (earnedIds.has(badge.id))
            continue;
        let qualifies = false;
        switch (badge.category) {
            case 'matches':
                qualifies = totalMatches >= badge.threshold;
                break;
            case 'wins':
                qualifies = totalWins >= badge.threshold;
                break;
            case 'community':
                qualifies = (postCount ?? 0) >= badge.threshold;
                break;
        }
        if (qualifies) {
            newAwards.push({ user_id: userId, badge_id: badge.id });
        }
    }
    if (newAwards.length > 0) {
        await supabase_1.supabase.from('user_badges').insert(newAwards);
    }
    return res.json({
        awarded: newAwards.length,
        badges: newAwards.map((a) => {
            const badge = (allBadges || []).find((b) => b.id === a.badge_id);
            return { slug: badge?.slug, category: badge?.category };
        }),
    });
}
exports.evaluateBadges = evaluateBadges;
//# sourceMappingURL=badges.controller.js.map