"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeError = exports.err = exports.ok = void 0;
// Standardised response helpers. New endpoints should use these; existing
// endpoints can be migrated incrementally.
function ok(res, data, meta) {
    return res.json({ success: true, data, ...meta });
}
exports.ok = ok;
function err(res, status, message, code) {
    return res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
}
exports.err = err;
// Sanitize Supabase/DB error messages so internals don't leak to clients.
// In development mode we pass the raw message through for debugging.
function sanitizeError(error) {
    if (process.env.NODE_ENV !== 'production') {
        return error?.message ?? 'An unexpected error occurred';
    }
    return 'An unexpected error occurred';
}
exports.sanitizeError = sanitizeError;
//# sourceMappingURL=response.js.map