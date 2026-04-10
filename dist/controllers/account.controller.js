"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitFeedback = exports.revokeAllSessions = exports.revokeSession = exports.getSessions = exports.deleteAccount = void 0;
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
async function getSessions(req, res) {
    const userId = req.userId;
    const { data, error } = await supabase_1.supabase
        .from('sessions')
        .select('*')
        .eq('user_id', userId)
        .order('last_active', { ascending: false });
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ sessions: data ?? [] });
}
exports.getSessions = getSessions;
// DELETE /account/sessions/:sessionId
async function revokeSession(req, res) {
    const userId = req.userId;
    const { sessionId } = req.params;
    const { error } = await supabase_1.supabase
        .from('sessions')
        .delete()
        .eq('id', sessionId)
        .eq('user_id', userId);
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ success: true });
}
exports.revokeSession = revokeSession;
// DELETE /account/sessions — revoke all other sessions
async function revokeAllSessions(req, res) {
    const userId = req.userId;
    const { error } = await supabase_1.supabase
        .from('sessions')
        .delete()
        .eq('user_id', userId)
        .eq('is_current', false);
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ success: true, message: 'All other sessions revoked' });
}
exports.revokeAllSessions = revokeAllSessions;
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