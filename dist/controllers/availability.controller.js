"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAvailability = exports.getAvailability = void 0;
const supabase_1 = require("../utils/supabase");
// ─── GET MY AVAILABILITY ────────────────────────────────────────────────────
async function getAvailability(req, res) {
    const userId = req.userId;
    const { data, error } = await supabase_1.supabase
        .from('player_availability')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
    if (error)
        return res.status(500).json({ error: error.message });
    // Return defaults if no record exists
    return res.json({
        data: data || {
            status: 'not_available',
            sport_ids: [],
            date_from: null,
            date_to: null,
            hide_stats: false,
            hide_dob: false,
        },
    });
}
exports.getAvailability = getAvailability;
// ─── UPDATE AVAILABILITY ────────────────────────────────────────────────────
async function updateAvailability(req, res) {
    const userId = req.userId;
    const { status, sport_ids, date_from, date_to, hide_stats, hide_dob } = req.body;
    const { data, error } = await supabase_1.supabase
        .from('player_availability')
        .upsert({
        user_id: userId,
        status: status || 'not_available',
        sport_ids: sport_ids || [],
        date_from: date_from || null,
        date_to: date_to || null,
        hide_stats: hide_stats ?? false,
        hide_dob: hide_dob ?? false,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
        .select()
        .single();
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ data });
}
exports.updateAvailability = updateAvailability;
//# sourceMappingURL=availability.controller.js.map