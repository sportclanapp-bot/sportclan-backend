"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteMatchEvent = exports.editMatchEvent = exports.applyDLS = exports.setMatchAvailability = exports.getMatchAvailability = exports.getMatchMVP = exports.calculateAndSetMVP = void 0;
const supabase_1 = require("../utils/supabase");
const response_1 = require("../utils/response");
const dls_1 = require("../utils/dls");
// ────────────────────────────────────────────────────────────────────────────
// FEATURE 1 — MVP / Player of the Match
// ────────────────────────────────────────────────────────────────────────────
async function calculateAndSetMVP(matchId) {
    // Get match events and participants
    const { data: events } = await supabase_1.supabase
        .from('match_events')
        .select('payload, created_by')
        .eq('match_id', matchId);
    const { data: participants } = await supabase_1.supabase
        .from('match_participants')
        .select('user_id')
        .eq('match_id', matchId);
    if (!events?.length || !participants?.length)
        return null;
    // Score each participant based on events
    const scores = new Map();
    for (const p of participants)
        scores.set(p.user_id, 0);
    for (const ev of events) {
        const payload = ev.payload ?? {};
        const userId = ev.created_by;
        if (!userId || !scores.has(userId))
            continue;
        const current = scores.get(userId) ?? 0;
        const runs = payload.runs ?? 0;
        const wicket = payload.wicket ? 25 : 0;
        scores.set(userId, current + runs + wicket);
    }
    // Find top scorer
    let mvpId = null;
    let maxScore = 0;
    for (const [uid, score] of scores) {
        if (score > maxScore) {
            maxScore = score;
            mvpId = uid;
        }
    }
    if (mvpId) {
        await supabase_1.supabase.from('matches').update({ mvp_user_id: mvpId }).eq('id', matchId);
    }
    return mvpId;
}
exports.calculateAndSetMVP = calculateAndSetMVP;
async function getMatchMVP(req, res) {
    try {
        const { id } = req.params;
        const { data: match } = await supabase_1.supabase
            .from('matches')
            .select('mvp_user_id')
            .eq('id', id)
            .maybeSingle();
        if (!match?.mvp_user_id)
            return res.json({ mvp: null });
        const { data: user } = await supabase_1.supabase
            .from('users')
            .select('id, name, username, profile_picture_url, is_premium')
            .eq('id', match.mvp_user_id)
            .maybeSingle();
        return res.json({ mvp: user });
    }
    catch {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.getMatchMVP = getMatchMVP;
// ────────────────────────────────────────────────────────────────────────────
// FEATURE 3 — Squad Availability
// ────────────────────────────────────────────────────────────────────────────
async function getMatchAvailability(req, res) {
    try {
        const { id } = req.params;
        const { data, error } = await supabase_1.supabase
            .from('match_availability')
            .select('id, user_id, team_id, status, user:users!user_id(id, name, profile_picture_url)')
            .eq('match_id', id);
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        return res.json({ availability: data ?? [] });
    }
    catch {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.getMatchAvailability = getMatchAvailability;
async function setMatchAvailability(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { id } = req.params;
        const { status, team_id } = req.body || {};
        if (!status || !['available', 'unavailable', 'maybe'].includes(status)) {
            return res.status(400).json({ error: 'status must be available, unavailable, or maybe' });
        }
        const { data, error } = await supabase_1.supabase
            .from('match_availability')
            .upsert({ match_id: id, user_id: userId, team_id: team_id ?? null, status, updated_at: new Date().toISOString() }, { onConflict: 'match_id,user_id' })
            .select('*')
            .single();
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        return res.json({ availability: data });
    }
    catch {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.setMatchAvailability = setMatchAvailability;
// ────────────────────────────────────────────────────────────────────────────
// FEATURE 5 — DLS Method
// ────────────────────────────────────────────────────────────────────────────
async function applyDLS(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { id } = req.params;
        const { team1_score, total_overs, team2_overs_remaining, team2_wickets } = req.body || {};
        if (team1_score == null || total_overs == null || team2_overs_remaining == null || team2_wickets == null) {
            return res.status(400).json({ error: 'team1_score, total_overs, team2_overs_remaining, team2_wickets required' });
        }
        const result = (0, dls_1.calculateDLSTarget)(Number(team1_score), Number(total_overs), Number(team2_overs_remaining), Number(team2_wickets));
        // Store in match score_summary
        const { data: match } = await supabase_1.supabase
            .from('matches')
            .select('score_summary')
            .eq('id', id)
            .maybeSingle();
        const ss = (match?.score_summary ?? {});
        ss.dls_target = result.revisedTarget;
        ss.dls_applied = true;
        ss.dls_resources = { team1: result.resourcesTeam1, team2: result.resourcesTeam2 };
        await supabase_1.supabase.from('matches').update({ score_summary: ss }).eq('id', id);
        return res.json(result);
    }
    catch {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.applyDLS = applyDLS;
// ────────────────────────────────────────────────────────────────────────────
// FEATURE 6 — Live Match Edit
// ────────────────────────────────────────────────────────────────────────────
async function editMatchEvent(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { id } = req.params;
        const { event_id, changes } = req.body || {};
        if (!event_id || !changes)
            return res.status(400).json({ error: 'event_id and changes required' });
        // Verify scorer/umpire/creator
        const { data: match } = await supabase_1.supabase
            .from('matches')
            .select('created_by, umpire_id')
            .eq('id', id)
            .maybeSingle();
        if (!match)
            return res.status(404).json({ error: 'Match not found' });
        if (match.created_by !== userId && match.umpire_id !== userId) {
            return res.status(403).json({ error: 'Only scorer or umpire can edit events' });
        }
        // Get current event
        const { data: event } = await supabase_1.supabase
            .from('match_events')
            .select('id, payload')
            .eq('id', event_id)
            .eq('match_id', id)
            .maybeSingle();
        if (!event)
            return res.status(404).json({ error: 'Event not found' });
        const oldPayload = event.payload ?? {};
        const newPayload = { ...oldPayload, ...changes };
        // Audit log
        await supabase_1.supabase.from('match_event_audit').insert({
            event_id, match_id: id, changed_by: userId,
            old_payload: oldPayload, new_payload: newPayload, action: 'edit',
        });
        // Update event
        await supabase_1.supabase.from('match_events').update({ payload: newPayload }).eq('id', event_id);
        return res.json({ success: true, event: { id: event_id, payload: newPayload } });
    }
    catch {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.editMatchEvent = editMatchEvent;
async function deleteMatchEvent(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { id, eventId } = req.params;
        const { data: match } = await supabase_1.supabase
            .from('matches')
            .select('created_by, umpire_id')
            .eq('id', id)
            .maybeSingle();
        if (!match)
            return res.status(404).json({ error: 'Match not found' });
        if (match.created_by !== userId && match.umpire_id !== userId) {
            return res.status(403).json({ error: 'Only scorer or umpire can delete events' });
        }
        // Get event for audit
        const { data: event } = await supabase_1.supabase
            .from('match_events')
            .select('id, payload')
            .eq('id', eventId)
            .eq('match_id', id)
            .maybeSingle();
        if (!event)
            return res.status(404).json({ error: 'Event not found' });
        // Audit log
        await supabase_1.supabase.from('match_event_audit').insert({
            event_id: eventId, match_id: id, changed_by: userId,
            old_payload: event.payload ?? {}, new_payload: {}, action: 'delete',
        });
        // Delete
        await supabase_1.supabase.from('match_events').delete().eq('id', eventId);
        return res.json({ success: true });
    }
    catch {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.deleteMatchEvent = deleteMatchEvent;
// AI Commentary feature removed — kept manual CommentaryFeed only.
//# sourceMappingURL=matchFeatures.controller.js.map