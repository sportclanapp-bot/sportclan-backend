"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteOtp = exports.getOtp = exports.setOtp = void 0;
const redis_1 = require("@upstash/redis");
let _client = null;
function client() {
    if (_client)
        return _client;
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
        throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set');
    }
    _client = new redis_1.Redis({ url, token });
    return _client;
}
function otpKey(phone) {
    return `otp:${phone}`;
}
async function setOtp(phone, code, purpose, ttlSeconds = 300) {
    await client().set(otpKey(phone), JSON.stringify({ code, purpose }), { ex: ttlSeconds });
}
exports.setOtp = setOtp;
async function getOtp(phone) {
    const raw = await client().get(otpKey(phone));
    if (!raw)
        return null;
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return parsed;
    }
    catch {
        return null;
    }
}
exports.getOtp = getOtp;
async function deleteOtp(phone) {
    await client().del(otpKey(phone));
}
exports.deleteOtp = deleteOtp;
//# sourceMappingURL=redis.js.map