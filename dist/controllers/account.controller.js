"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitFeedback = exports.exportData = exports.revokeAllSessions = exports.revokeSession = exports.getSessions = exports.deleteAccount = void 0;
const supabase_1 = require("../utils/supabase");
// POST /account/delete — soft-delete with 30-day grace
async function deleteAccount(req, res) {
    const userId = req.userId;
    const { confirmation } = req.body || {};
    if (confirmation !== 'DELETE') {
        return res.status(400).json({ error: 'Type "DELETE" to confirm' });
    }
    await supabase_1.supabase.from('users').update({
        deleted_at: new Date().toISOString(),
        is_premium: false,
    }).eq('id', userId);
    return res.json({
        success: true,
        message: 'Account deactivated. Log in within 30 days to restore. Permanent deletion after 30 days.',
    });
}
exports.deleteAccount = deleteAccount;
// GET /account/sessions
// GET /account/sessions — returns the caller's active sessions.
//
// There's a `sessions` table in the schema but nothing actually writes to
// it — the real source of truth for who's signed in is `refresh_tokens`,
// which gets a row on every login. We read from there and synthesise a
// session shape the frontend can render: id, device label, last-used time,
// and a "This device" flag for the token that matches the current request.
async function getSessions(req, res) {
    const userId = req.userId;
    const currentRefreshToken = req.headers['x-refresh-token'] ?? null;
    const { data, error } = await supabase_1.supabase
        .from('refresh_tokens')
        .select('id, token, created_at, user_agent, device_name, last_used_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    if (error) {
        // If any of those optional columns don't exist, retry with just id/token/
        // created_at so the endpoint still works on older schemas.
        const fallback = await supabase_1.supabase
            .from('refresh_tokens')
            .select('id, token, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (fallback.error)
            return res.status(500).json({ error: fallback.error.message });
        const sessions = (fallback.data ?? []).map((row) => ({
            id: row.id,
            device_name: 'Mobile',
            device_os: null,
            ip_address: null,
            location: null,
            is_current: currentRefreshToken ? row.token === currentRefreshToken : false,
            last_active: row.created_at,
            created_at: row.created_at,
        }));
        return res.json({ sessions });
    }
    const sessions = (data ?? []).map((row) => ({
        id: row.id,
        device_name: row.device_name ?? row.user_agent ?? 'Mobile',
        device_os: null,
        ip_address: null,
        location: null,
        is_current: currentRefreshToken ? row.token === currentRefreshToken : false,
        last_active: row.last_used_at ?? row.created_at,
        created_at: row.created_at,
    }));
    // If we couldn't identify "this device" by the refresh token header, mark
    // the most recent row as current — that's the session the user is most
    // likely sitting in right now.
    if (!sessions.some((s) => s.is_current) && sessions.length > 0) {
        sessions[0].is_current = true;
    }
    return res.json({ sessions });
}
exports.getSessions = getSessions;
// DELETE /account/sessions/:sessionId — delete a single refresh_tokens row.
async function revokeSession(req, res) {
    const userId = req.userId;
    const { sessionId } = req.params;
    const { error } = await supabase_1.supabase
        .from('refresh_tokens')
        .delete()
        .eq('id', sessionId)
        .eq('user_id', userId);
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ success: true });
}
exports.revokeSession = revokeSession;
// DELETE /account/sessions/all — revoke all other refresh tokens.
// The caller's current token (X-Refresh-Token header) is preserved so they
// stay logged in on this device.
async function revokeAllSessions(req, res) {
    const userId = req.userId;
    const currentRefreshToken = req.headers['x-refresh-token'] ?? null;
    let query = supabase_1.supabase
        .from('refresh_tokens')
        .delete()
        .eq('user_id', userId);
    if (currentRefreshToken) {
        query = query.neq('token', currentRefreshToken);
    }
    const { error } = await query;
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ success: true, message: 'All other sessions revoked' });
}
exports.revokeAllSessions = revokeAllSessions;
// POST /account/export-data — DPDP Act right-to-portability.
// Assembles a JSON bundle of everything we store about the authenticated user
// that they've actually produced (profile, posts, matches, messages, txns,
// social graph). Inline, no background job yet — dataset sizes are small.
async function exportData(req, res) {
    const userId = req.userId;
    const [profileRes, postsRes, matchesRes, messagesRes, txnsRes, followersRes, followingRes, sportProfilesRes,] = await Promise.all([
        supabase_1.supabase
            .from('users')
            .select('id, phone, name, username, email, bio, gender, dob, city_id, created_at, is_premium, premium_expires_at, coin_balance')
            .eq('id', userId)
            .maybeSingle(),
        supabase_1.supabase
            .from('posts')
            .select('id, content, image_url, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false }),
        supabase_1.supabase
            .from('match_participants')
            .select('match_id, team_side, role, match:matches(id, sport_id, scheduled_at, status, winner_team_id)')
            .eq('user_id', userId),
        supabase_1.supabase
            .from('messages')
            .select('id, chat_id, content, created_at')
            .eq('sender_id', userId)
            .order('created_at', { ascending: false })
            .limit(100),
        supabase_1.supabase
            .from('transactions')
            .select('id, type, amount_inr, coins, description, status, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false }),
        supabase_1.supabase
            .from('follow_relationships')
            .select('follower_id, created_at')
            .eq('following_id', userId),
        supabase_1.supabase
            .from('follow_relationships')
            .select('following_id, created_at')
            .eq('follower_id', userId),
        supabase_1.supabase
            .from('user_sport_profiles')
            .select('sport_id, rating, matches_played, wins, losses, draws, last_match_at')
            .eq('user_id', userId),
    ]);
    return res.json({
        exportedAt: new Date().toISOString(),
        profile: profileRes.data ?? null,
        sport_profiles: sportProfilesRes.data ?? [],
        posts: postsRes.data ?? [],
        matches: matchesRes.data ?? [],
        messages_last_100: messagesRes.data ?? [],
        transactions: txnsRes.data ?? [],
        followers: followersRes.data ?? [],
        following: followingRes.data ?? [],
    });
}
exports.exportData = exportData;
// POST /account/feedback  { category, message, rating?, email? }
async function submitFeedback(req, res) {
    const userId = req.userId;
    const { category, message, rating, email } = req.body || {};
    if (!message || message.trim().length === 0) {
        return res.status(400).json({ error: 'message required' });
    }
    const { error } = await supabase_1.supabase.from('feedback').insert({
        user_id: userId,
        category: category || 'general',
        message: message.trim().slice(0, 1000),
        rating: rating || null,
        email: email || null,
    });
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ success: true, message: 'Feedback submitted. We reply within 48h.' });
}
exports.submitFeedback = submitFeedback;
//# sourceMappingURL=account.controller.js.map