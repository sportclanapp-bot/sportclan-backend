"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const supabase_1 = require("../utils/supabase");
const router = (0, express_1.Router)();
// GET /cities          → all cities (alphabetical)
// GET /cities?q=mum    → ilike search, capped at 25 results
router.get('/', async (req, res) => {
    const q = (req.query.q || '').trim();
    let query = supabase_1.supabase.from('cities').select('id, name, state').order('name', { ascending: true });
    if (q)
        query = query.ilike('name', `%${q}%`).limit(25);
    const { data, error } = await query;
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ cities: data || [] });
});
// Legacy alias — Part 2 frontend may still hit /cities/search.
router.get('/search', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q)
        return res.json({ cities: [] });
    const { data, error } = await supabase_1.supabase
        .from('cities')
        .select('id, name, state')
        .ilike('name', `%${q}%`)
        .order('name', { ascending: true })
        .limit(25);
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ cities: data || [] });
});
exports.default = router;
//# sourceMappingURL=cities.routes.js.map