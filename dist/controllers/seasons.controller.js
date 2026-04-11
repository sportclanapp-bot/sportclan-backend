"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.endSeason = exports.getCurrentSeason = void 0;
const supabase_1 = require("../utils/supabase");
const notify_1 = require("../utils/notify");
// GET /seasons/current
// Returns the active season, days remaining, the caller's per-sport stats
// for this season (rating, rank, matches played), and any medals they've
// earned in previous seasons.
async function getCurrentSeason(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const { data: season, error: sErr } = await supabase_1.supabase
        .from('seasons')
        .select('id, season_number, name, starts_at, ends_at, is_active')
        .eq('is_active', true)
        .order('starts_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (sErr)
        return res.status(500).json({ error: sErr.message });
    const now = Date.now();
    const daysRemaining = season
        ? Math.max(0, Math.ceil((new Date(season.ends_at).getTime() - now) / (24 * 60 * 60 * 1000)))
        : 0;
    const totalDays = season
        ? Math.max(1, Math.ceil((new Date(season.ends_at).getTime() - new Date(season.starts_at).getTime()) / (24 * 60 * 60 * 1000)))
        : 1;
    const daysElapsed = Math.max(0, totalDays - daysRemaining);
    const completionPct = Math.min(100, Math.round((daysElapsed / totalDays) * 100));
    // Per-sport stats for the caller. Rating history filtered to since the
    // season started gives us the matches-this-season count. The current rating
    // comes from user_sport_profiles.
    const sinceIso = season?.starts_at ?? new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: profiles } = await supabase_1.supabase
        .from('user_sport_profiles')
        .select('sport_id, rating, matches_played, wins')
        .eq('user_id', userId);
    // For each profile, compute matches_this_season and rank by querying
    // rating_history / user_sport_profiles respectively.
    const sportIds = (profiles ?? []).map((p) => p.sport_id);
    const sportNames = new Map();
    if (sportIds.length > 0) {
        const { data: sports } = await supabase_1.supabase
            .from('sports')
            .select('id, name, emoji')
            .in('id', sportIds);
        for (const s of sports ?? [])
            sportNames.set(s.id, { name: s.name, emoji: s.emoji });
    }
    const sportStats = await Promise.all((profiles ?? []).map(async (p) => {
        const { count: matchesThisSeason } = await supabase_1.supabase
            .from('rating_history')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('sport_id', p.sport_id)
            .gte('created_at', sinceIso);
        // Rank = number of profiles with strictly higher rating + 1.
        const { count: higher } = await supabase_1.supabase
            .from('user_sport_profiles')
            .select('id', { count: 'exact', head: true })
            .eq('sport_id', p.sport_id)
            .gt('rating', p.rating);
        const meta = sportNames.get(p.sport_id);
        return {
            sport_id: p.sport_id,
            sport_name: meta?.name ?? null,
            sport_emoji: meta?.emoji ?? null,
            rating: p.rating,
            matches_this_season: matchesThisSeason ?? 0,
            rank: (higher ?? 0) + 1,
        };
    }));
    // Medals earned in past seasons. season_medals has:
    // id, user_id, season_id, sport_id, medal_type, created_at.
    const { data: medalRows } = await supabase_1.supabase
        .from('season_medals')
        .select('id, season_id, sport_id, medal_type, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    const medalSeasonIds = Array.from(new Set((medalRows ?? []).map((m) => m.season_id)));
    const seasonNameMap = new Map();
    if (medalSeasonIds.length > 0) {
        const { data: seasonRows } = await supabase_1.supabase
            .from('seasons')
            .select('id, name, season_number')
            .in('id', medalSeasonIds);
        for (const s of seasonRows ?? [])
            seasonNameMap.set(s.id, s.name);
    }
    const medalSportIds = Array.from(new Set((medalRows ?? []).map((m) => m.sport_id).filter(Boolean)));
    const medalSportNameMap = new Map();
    if (medalSportIds.length > 0) {
        const { data: sports } = await supabase_1.supabase
            .from('sports')
            .select('id, name, emoji')
            .in('id', medalSportIds);
        for (const s of sports ?? [])
            medalSportNameMap.set(s.id, { name: s.name, emoji: s.emoji });
    }
    const medals = (medalRows ?? []).map((m) => ({
        id: m.id,
        season_id: m.season_id,
        season_name: seasonNameMap.get(m.season_id) ?? 'Season',
        sport_id: m.sport_id,
        sport_name: m.sport_id ? medalSportNameMap.get(m.sport_id)?.name ?? null : null,
        sport_emoji: m.sport_id ? medalSportNameMap.get(m.sport_id)?.emoji ?? null : null,
        medal_type: m.medal_type,
        created_at: m.created_at,
    }));
    return res.json({
        season,
        days_remaining: daysRemaining,
        completion_pct: completionPct,
        sport_stats: sportStats,
        medals,
    });
}
exports.getCurrentSeason = getCurrentSeason;
// POST /seasons/end  (admin-only)
// Awards medals to top 3 per sport based on user_sport_profiles.rating,
// inserts season_medals rows, fan-outs a push notification to everyone,
// and creates the next season (3 months from now).
async function endSeason(req, res) {
    const adminKey = req.headers['x-admin-key'];
    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
        return res.status(403).json({ error: 'Admin key required' });
    }
    const { data: season } = await supabase_1.supabase
        .from('seasons')
        .select('*')
        .eq('is_active', true)
        .order('starts_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!season)
        return res.status(404).json({ error: 'No active season' });
    // Top 3 per sport — iterate sports, rank profiles, insert medals.
    const { data: sports } = await supabase_1.supabase.from('sports').select('id, name');
    const insertRows = [];
    for (const sport of sports ?? []) {
        const { data: top } = await supabase_1.supabase
            .from('user_sport_profiles')
            .select('user_id, rating')
            .eq('sport_id', sport.id)
            .gt('matches_played', 0)
            .order('rating', { ascending: false })
            .limit(3);
        const medalMap = ['gold', 'silver', 'bronze'];
        (top ?? []).forEach((row, idx) => {
            insertRows.push({
                user_id: row.user_id,
                season_id: season.id,
                sport_id: sport.id,
                medal_type: medalMap[idx] ?? 'participant',
            });
        });
    }
    if (insertRows.length > 0) {
        await supabase_1.supabase.from('season_medals').insert(insertRows);
    }
    // Close current season + create the next one.
    await supabase_1.supabase
        .from('seasons')
        .update({ is_active: false })
        .eq('id', season.id);
    const nextStart = new Date();
    const nextEnd = new Date(nextStart);
    nextEnd.setMonth(nextEnd.getMonth() + 3);
    const { data: nextSeason } = await supabase_1.supabase
        .from('seasons')
        .insert({
        season_number: (season.season_number ?? 0) + 1,
        name: `Season ${(season.season_number ?? 0) + 1}`,
        starts_at: nextStart.toISOString(),
        ends_at: nextEnd.toISOString(),
        is_active: true,
    })
        .select('*')
        .single();
    // Fan out push to all users with push tokens. Pulls distinct user_ids.
    try {
        const { data: tokenUsers } = await supabase_1.supabase
            .from('push_tokens')
            .select('user_id');
        const ids = Array.from(new Set((tokenUsers ?? []).map((t) => t.user_id)));
        if (ids.length > 0) {
            await (0, notify_1.notifyUsers)(ids, {
                type: 'season_ended',
                title: `${season.name} complete!`,
                body: `Check out your season medals \uD83C\uDFC5. ${nextSeason?.name ?? 'Next season'} starts now!`,
                data: { screen: 'Season' },
            });
        }
    }
    catch {
        // best effort
    }
    return res.json({
        endedSeasonId: season.id,
        medalsAwarded: insertRows.length,
        nextSeason,
    });
}
exports.endSeason = endSeason;
//# sourceMappingURL=seasons.controller.js.map