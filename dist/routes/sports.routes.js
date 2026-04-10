"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const supabase_1 = require("../utils/supabase");
const router = (0, express_1.Router)();
router.get('/', async (_req, res) => {
    const { data, error } = await supabase_1.supabase
        .from('sports')
        .select('id, name, slug, emoji, color')
        .order('display_order', { ascending: true });
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ sports: data || [] });
});
exports.default = router;
//# sourceMappingURL=sports.routes.js.map