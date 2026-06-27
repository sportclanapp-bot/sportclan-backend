"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitFeedback = exports.exportData = exports.revokeAllSessions = exports.revokeSession = exports.getSessions = exports.purgeExpiredAccounts = exports.deleteAccount = void 0;
const supabase_1 = require("../utils/supabase");
// POST /account/delete — soft-delete with 30-day grace + immediate PII scrub
//
// Privacy posture: We keep the row alive for 30 days so the user can restore
// by signing in again, but we scrub identifiable fields immediately to honor
// the "delete on request" expectation from Play Data Safety / DPDP. After
// 30 days, /account/purge-expired (cron-callable) hard-deletes the row.
//
// Scrubbed-now (so they vanish from any UI surface immediately):
//   name → "Deleted User"
//   username → "deleted_<short-uuid>" (preserves DB uniqueness constraint)
//   email → null
//   phone → still kept (needed to restore via OTP within the grace window)
//   profile_picture_url → null
//   bio → null
//   gender, dob → null
//
// Kept until permanent purge: phone (for restore), user-id references on
// content (so threads don't lose their structure during the grace period).
async function deleteAccount(req, res) {
    const userId = req.userId;
    const { confirmation } = req.body || {};
    if (confirmation !== 'DELETE') {
        return res.status(400).json({ error: 'Type "DELETE" to confirm' });
    }
    // Scrub identifiable fields immediately.
    const shortId = userId.slice(0, 8);
    const { error } = await supabase_1.supabase.from('users').update({
        deleted_at: new Date().toISOString(),
        is_premium: false,
        name: 'Deleted User',
        username: `deleted_${shortId}`,
        email: null,
        profile_picture_url: null,
        bio: null,
        gender: null,
        dob: null,
    }).eq('id', userId);
    if (error)
        return res.status(500).json({ error: 'Could not deactivate account' });
    // Revoke all sessions so the user can't keep using the app on other devices
    // during the 30-day grace.
    await supabase_1.supabase.from('refresh_tokens').delete().eq('user_id', userId);
    // Also remove push tokens — no more notifications.
    await supabase_1.supabase.from('push_tokens').delete().eq('user_id', userId).catch(() => null);
    return res.json({
        success: true,
        message: 'Account deactivated and personal data scrubbed. Sign in within 30 days with the same phone to restore. After 30 days, the account is permanently deleted.',
    });
}
exports.deleteAccount = deleteAccount;
// POST /account/purge-expired — cron-callable endpoint (must include
// X-Cron-Secret header matching CRON_SECRET env). Hard-deletes accounts
// whose deleted_at is older than 30 days.
//
// Production: hook this up to a Render cron job or Supabase pg_cron to run
// daily.
async function purgeExpiredAccounts(req, res) {
    const secret = req.headers['x-cron-secret'];
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    // Find users past the grace window
    const { data: expired, error: fetchErr } = await supabase_1.supabase
        .from('users')
        .select('id')
        .lt('deleted_at', cutoff)
        .not('deleted_at', 'is', null);
    if (fetchErr)
        return res.status(500).json({ error: fetchErr.message });
    if (!expired || expired.length === 0)
        return res.json({ purged: 0 });
    const ids = expired.map((u) => u.id);
    // Hard-delete the user rows. FK cascades on user_id should clear content
    // automatically; anything that's set to SET NULL will detach.
    const { error: delErr } = await supabase_1.supabase.from('users').delete().in('id', ids);
    if (delErr)
        return res.status(500).json({ error: delErr.message });
    return res.json({ purged: ids.length, ids });
}
exports.purgeExpiredAccounts = purgeExpiredAccounts;
// GET /account/sessions — returns the caller's active sessions, deduped
// per device.
//
// refresh_tokens accumulates a new row every time the app rotates its
// token (which happens on every login and on every silent refresh), so a
// single device can easily have dozens of rows. We read all rows for the
// user ordered newest-first, then keep only the MOST RECENT row for each
// unique device. The device key is `device_info`/`device_name`/`user_agent`
// if any of them exist, else the last 8 chars of the token as a stable
// fallback. Capped at 10 sessions.
async function getSessions(req, res) {
    const userId = req.userId;
    const currentRefreshToken = req.headers['x-refresh-token'] ?? null;
    // Try the rich schema first. If some of the optional columns don't
    // exist, fall back to the minimal id/token/created_at set.
    let rows = [];
    {
        const rich = await supabase_1.supabase
            .from('refresh_tokens')
            .select('id, token, created_at, user_agent, device_name, device_info, last_used_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (!rich.error) {
            rows = rich.data ?? [];
        }
        else {
            const fallback = await supabase_1.supabase
                .from('refresh_tokens')
                .select('id, token, created_at')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });
            if (fallback.error)
                return res.status(500).json({ error: fallback.error.message });
            rows = fallback.data ?? [];
        }
    }
    // Dedup newest-first per device key. We iterate in order (already desc
    // by created_at) and keep the first occurrence for each device.
    const seen = new Set();
    const deduped = [];
    for (const row of rows) {
        const deviceKey = (row.device_info && String(row.device_info)) ||
            (row.device_name && String(row.device_name)) ||
            (row.user_agent && String(row.user_agent)) ||
            // Fallback: use the last 8 chars of the token. Unique enough per
            // device since tokens are 100+ chars and rotate frequently.
            `tok_${String(row.token ?? '').slice(-8) || row.id}`;
        if (seen.has(deviceKey))
            continue;
        seen.add(deviceKey);
        deduped.push({ ...row, _deviceKey: deviceKey });
        if (deduped.length >= 10)
            break;
    }
    const sessions = deduped.map((row) => ({
        id: row.id,
        device_name: row.device_info ?? row.device_name ?? row.user_agent ?? 'Mobile device',
        device_os: null,
        ip_address: null,
        location: null,
        is_current: currentRefreshToken ? row.token === currentRefreshToken : false,
        last_active: row.last_used_at ?? row.created_at,
        created_at: row.created_at,
    }));
    // If we couldn't identify "this device" by the refresh token header, mark
    // the most recently used row as current — that's almost always the
    // session the user is sitting in right now.
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