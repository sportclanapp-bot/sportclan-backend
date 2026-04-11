"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listChallenges = void 0;
const supabase_1 = require("../utils/supabase");
// GET /challenges — list active challenges and the caller's current
// progress for each (joining user_challenges). Progress is best-effort:
// if a user hasn't opted in we just return zero.
async function listChallenges(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const nowIso = new Date().toISOString();
    const { data: challenges, error } = await supabase_1.supabase
        .from('challenges')
        .select('*')
        .eq('active', true)
        .lte('starts_at', nowIso)
        .gte('ends_at', nowIso)
        .order('ends_at', { ascending: true });
    if (error)
        return res.status(500).json({ error: error.message });
    const ids = (challenges ?? []).map((c) => c.id);
    const progressMap = new Map();
    if (ids.length > 0) {
        const { data: ucs } = await supabase_1.supabase
            .from('user_challenges')
            .select('challenge_id, progress, completed')
            .eq('user_id', userId)
            .in('challenge_id', ids);
        for (const uc of ucs ?? []) {
            progressMap.set(uc.challenge_id, { progress: uc.progress, completed: uc.completed });
        }
    }
    const merged = (challenges ?? []).map((c) => {
        const p = progressMap.get(c.id);
        return {
            id: c.id,
            title: c.title,
            description: c.description,
            sport_id: c.sport_id,
            target_count: c.target_count,
            reward_coins: c.reward_coins,
            reward_badge_slug: c.reward_badge_slug,
            ends_at: c.ends_at,
            progress: p?.progress ?? 0,
            completed: p?.completed ?? false,
        };
    });
    return res.json({ challenges: merged });
}
exports.listChallenges = listChallenges;
//# sourceMappingURL=challenges.controller.js.map