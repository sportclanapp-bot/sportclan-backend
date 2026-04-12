"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateToken = void 0;
const jwt_1 = require("../utils/jwt");
const supabase_1 = require("../utils/supabase");
function authenticateToken(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token)
        return res.status(401).json({ error: 'Missing token' });
    try {
        const payload = (0, jwt_1.verifyAccessToken)(token);
        req.userId = payload.userId;
        // Fire-and-forget last_active_at update — no await, no error check
        supabase_1.supabase.from('users').update({ last_active_at: new Date().toISOString() }).eq('id', payload.userId).then(() => { });
        return next();
    }
    catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}
exports.authenticateToken = authenticateToken;
//# sourceMappingURL=auth.middleware.js.map