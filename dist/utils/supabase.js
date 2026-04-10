"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
let _client = null;
function build() {
    const url = process.env.SUPABASE_URL || '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!url || !serviceKey) {
        throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env before calling Supabase.');
    }
    return (0, supabase_js_1.createClient)(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}
// Lazy proxy: server boots even without env; first DB call constructs the client.
exports.supabase = new Proxy({}, {
    get(_target, prop) {
        if (!_client)
            _client = build();
        // @ts-expect-error dynamic forwarding
        const value = _client[prop];
        return typeof value === 'function' ? value.bind(_client) : value;
    },
});
//# sourceMappingURL=supabase.js.map