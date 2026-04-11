"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertVenue = exports.createVenue = exports.searchVenues = void 0;
const supabase_1 = require("../utils/supabase");
// GET /venues?city_id=&q=
// * q present → case-insensitive prefix match on name, ordered by use_count desc
// * q empty   → top 5 most-used venues for the given city
async function searchVenues(req, res) {
    const { city_id, q } = req.query;
    const limit = 10;
    let query = supabase_1.supabase
        .from('venues')
        .select('id, name, city_id, use_count, created_at')
        .order('use_count', { ascending: false })
        .limit(limit);
    if (city_id)
        query = query.eq('city_id', city_id);
    if (q && q.trim().length > 0) {
        query = query.ilike('name', `%${q.trim()}%`);
    }
    const { data, error } = await query;
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ venues: data ?? [] });
}
exports.searchVenues = searchVenues;
// POST /venues  { name, city_id? }
// Creates a venue if it doesn't exist (case insensitive), otherwise returns
// the existing one. createMatch calls this too via upsertVenue below, but
// exposing it as a REST endpoint lets the autocomplete field freshly create.
async function createVenue(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const { name, city_id } = req.body || {};
    if (!name || typeof name !== 'string')
        return res.status(400).json({ error: 'name is required' });
    const row = await upsertVenue(name.trim(), city_id ?? null, userId);
    return res.json({ venue: row });
}
exports.createVenue = createVenue;
// Shared helper used by createMatch to increment use_count on an existing
// venue name or insert a new row. Best-effort — never throws.
async function upsertVenue(name, cityId, createdBy) {
    try {
        const clean = name.trim();
        if (!clean)
            return null;
        // Case-insensitive existence check scoped by city when provided.
        let existingQuery = supabase_1.supabase
            .from('venues')
            .select('id, name, city_id, use_count')
            .ilike('name', clean);
        if (cityId)
            existingQuery = existingQuery.eq('city_id', cityId);
        const { data: existing } = await existingQuery.limit(1).maybeSingle();
        if (existing) {
            await supabase_1.supabase
                .from('venues')
                .update({ use_count: (existing.use_count ?? 0) + 1 })
                .eq('id', existing.id);
            return { ...existing, use_count: (existing.use_count ?? 0) + 1 };
        }
        const { data: created } = await supabase_1.supabase
            .from('venues')
            .insert({
            name: clean,
            city_id: cityId,
            use_count: 1,
            created_by: createdBy,
        })
            .select('*')
            .single();
        return created ?? null;
    }
    catch {
        return null;
    }
}
exports.upsertVenue = upsertVenue;
//# sourceMappingURL=venues.controller.js.map