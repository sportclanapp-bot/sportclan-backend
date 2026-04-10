"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTransactions = void 0;
const supabase_1 = require("../utils/supabase");
// GET /transactions?type=&limit=&offset=
async function getTransactions(req, res) {
    const userId = req.userId;
    const type = req.query.type;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    let query = supabase_1.supabase
        .from('transactions')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (type)
        query = query.eq('type', type);
    const { data, count, error } = await query;
    if (error)
        return res.status(500).json({ error: error.message });
    return res.json({ transactions: data ?? [], total: count ?? 0 });
}
exports.getTransactions = getTransactions;
//# sourceMappingURL=transactions.controller.js.map