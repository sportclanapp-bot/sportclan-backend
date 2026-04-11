"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadTestData = void 0;
const supabase_1 = require("../utils/supabase");
// POST /dev/load-test-data
// Dev-only endpoint that seeds test data for the current user:
//   - Creates 1 live cricket match
//   - Creates 3 community posts
//   - Sets coin_balance to 500
//   - Creates 5 test notifications (one of each main type)
// Gated to NODE_ENV !== 'production'.
async function loadTestData(req, res) {
    if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({ error: 'Not available in production' });
    }
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const summary = {
        match: null,
        posts: 0,
        coins: 0,
        notifications: 0,
    };
    try {
        // 1. Find cricket sport UUID
        const { data: cricket } = await supabase_1.supabase
            .from('sports')
            .select('id')
            .ilike('name', 'cricket')
            .maybeSingle();
        // 2. Create a live cricket match
        if (cricket) {
            const { data: match } = await supabase_1.supabase
                .from('matches')
                .insert({
                sport_id: cricket.id,
                team_a_name: 'Mumbai Strikers',
                team_b_name: 'Delhi Kings',
                scheduled_at: new Date().toISOString(),
                venue: 'Wankhede Stadium',
                format: 'T20',
                overs: 20,
                status: 'live',
                created_by: userId,
                score_summary: {
                    team_a: '145/6',
                    team_b: '89/2',
                    overs_a: '18.3',
                    overs_b: '11.0',
                },
            })
                .select('id')
                .single();
            if (match)
                summary.match = { id: match.id };
        }
        // 3. Create 3 community posts
        const posts = [
            { content: 'Just finished an amazing practice session! Who wants to play a match this weekend? \uD83C\uDFCF', post_type: 'Player' },
            { content: 'Looking for an umpire for Sunday\'s tournament. DM me if interested.', post_type: 'Umpire-Referee' },
            { content: 'Great turnout at today\'s match. Thanks to everyone who came out!', post_type: 'Match' },
        ];
        for (const p of posts) {
            const { error } = await supabase_1.supabase
                .from('community_posts')
                .insert({
                author_id: userId,
                content: p.content,
                post_type: p.post_type,
                sport_id: cricket?.id ?? null,
                likes_count: Math.floor(Math.random() * 20),
                comments_count: Math.floor(Math.random() * 5),
            });
            if (!error)
                summary.posts += 1;
        }
        // 4. Set coin balance to 500 and mark premium
        await supabase_1.supabase
            .from('users')
            .update({
            coin_balance: 500,
            is_premium: true,
            premium_expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        })
            .eq('id', userId);
        summary.coins = 500;
        // 5. Create test notifications (one of each type)
        const notifs = [
            { type: 'follow', title: 'New follower', body: 'Arjun P. started following you', data: { user_id: userId } },
            { type: 'match_result', title: 'Match result', body: 'Your match just ended. Tap to view.', data: summary.match ? { match_id: summary.match.id } : {} },
            { type: 'gift', title: 'You received a gift', body: 'Priya S. sent you a Trophy \uD83C\uDFC6', data: {} },
            { type: 'like', title: 'Post liked', body: 'Vikas K. liked your post', data: {} },
            { type: 'reminder', title: 'Match reminder', body: 'Your match starts in 1 hour', data: summary.match ? { match_id: summary.match.id } : {} },
        ];
        for (const n of notifs) {
            const { error } = await supabase_1.supabase
                .from('notifications')
                .insert({
                user_id: userId,
                type: n.type,
                title: n.title,
                body: n.body,
                data: n.data,
                read: false,
            });
            if (!error)
                summary.notifications += 1;
        }
        return res.json({ success: true, summary });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message ?? 'Failed to load test data' });
    }
}
exports.loadTestData = loadTestData;
//# sourceMappingURL=dev.controller.js.map