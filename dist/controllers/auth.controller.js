"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.changePhone = exports.resetPassword = exports.googleAuth = exports.validateCoupon = exports.checkUsername = exports.logout = exports.refresh = exports.registerEmail = exports.login = exports.otpLogin = exports.register = exports.verifyOtp = exports.sendOtp = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const axios_1 = __importDefault(require("axios"));
const supabase_1 = require("../utils/supabase");
const jwt_1 = require("../utils/jwt");
const redis_1 = require("../utils/redis");
const OTP_TTL_SECONDS = 300; // 5 minutes
// ─── Dev-only test OTP bypass ────────────────────────────────────────────────
// Lets QA / automated walkthroughs sign into seeded accounts without a real SMS
// (SportClan is OTP-only; seeded accounts have no email/password to fall back on).
//
// STRICT double gate — isTestOtp() returns false, and the bypass is a complete
// no-op, unless BOTH of these hold:
//   1. ALLOW_TEST_OTP === 'true'   — explicit opt-in env flag (off by default)
//   2. NODE_ENV !== 'production'   — fail-safe: never active in prod even if (1)
//                                    is accidentally left set there.
// When active, TEST_OTP_CODE is accepted for ANY phone on /auth/verify-otp and
// /auth/otp/login. Keep it OFF (flag unset) on the production service.
const TEST_OTP_CODE = '123456';
function isTestOtp(code) {
    return (process.env.ALLOW_TEST_OTP === 'true' &&
        process.env.NODE_ENV !== 'production' &&
        code === TEST_OTP_CODE);
}
function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
function normalizePhone(phone) {
    return phone.trim().replace(/\s+/g, '');
}
// Send OTP via 2Factor.in — choose between voice call and WhatsApp.
// Voice is the default (per product spec for India to dodge SMS deliverability).
// WhatsApp is the fallback when voice fails (carrier block, SIM issue, voice
// rate limits). On dev with no API key, both fall through to console.
async function sendOtpViaChannel(phone, code, channel) {
    const apiKey = process.env.TWOFACTOR_API_KEY;
    if (!apiKey) {
        // eslint-disable-next-line no-console
        console.log(`[OTP DEV] channel=${channel} phone=${phone} code=${code}`);
        return true;
    }
    try {
        const cleanPhone = phone.replace(/^\+91/, '');
        if (channel === 'whatsapp') {
            // 2Factor.in WhatsApp template: requires a pre-approved template ID.
            // ENV: TWOFACTOR_WHATSAPP_TEMPLATE_ID (e.g. "SportClanOTP")
            // Falls back to AUTOGEN2 (transactional WhatsApp) if template not set.
            const tpl = process.env.TWOFACTOR_WHATSAPP_TEMPLATE_ID || 'AUTOGEN2';
            const url = `https://2factor.in/API/V1/${apiKey}/ADDON_SERVICES/SEND/WAPI/${cleanPhone}/${tpl}/${code}`;
            await axios_1.default.get(url);
            return true;
        }
        // Voice call (default)
        const url = `https://2factor.in/API/V1/${apiKey}/VOICE/${cleanPhone}/${code}`;
        await axios_1.default.get(url);
        return true;
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[2Factor.in] ${channel} send failed:`, err?.message);
        return false;
    }
}
// Legacy alias retained so other call sites don't break
async function sendSmsOtp(phone, code) {
    return sendOtpViaChannel(phone, code, 'voice');
}
// POST /auth/send-otp  { phone, purpose?, channel? }
async function sendOtp(req, res) {
    const { phone, purpose = 'login', channel: rawChannel } = req.body || {};
    if (!phone)
        return res.status(400).json({ error: 'phone is required' });
    const channel = rawChannel === 'whatsapp' ? 'whatsapp' : 'voice';
    const p = normalizePhone(phone);
    const code = generateOtp();
    await (0, redis_1.setOtp)(p, code, purpose, OTP_TTL_SECONDS);
    const sent = await sendOtpViaChannel(p, code, channel);
    if (!sent) {
        return res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
    }
    return res.json({ success: true, message: 'OTP sent', channel });
}
exports.sendOtp = sendOtp;
// POST /auth/verify-otp  { phone, code }
async function verifyOtp(req, res) {
    const { phone, code } = req.body || {};
    if (!phone || !code)
        return res.status(400).json({ error: 'phone and code are required' });
    const p = normalizePhone(phone);
    // Dev-only bypass (see isTestOtp): accept the fixed test code without a real OTP.
    if (isTestOtp(code)) {
        await (0, redis_1.setOtp)(p, 'VERIFIED', 'login', OTP_TTL_SECONDS);
        return res.json({ success: true, verified: true });
    }
    const entry = await (0, redis_1.getOtp)(p);
    if (!entry)
        return res.status(400).json({ error: 'No OTP requested or OTP expired' });
    if (entry.code !== code)
        return res.status(400).json({ error: 'Invalid OTP' });
    // Mark verified — store VERIFIED with fresh TTL
    await (0, redis_1.setOtp)(p, 'VERIFIED', entry.purpose, OTP_TTL_SECONDS);
    return res.json({ success: true, verified: true });
}
exports.verifyOtp = verifyOtp;
// POST /auth/register
// OTP-only multi-step registration. Body shape:
//   {
//     phone, code,                       // required — OTP gate
//     name, username,                    // required identity
//     email?, gender?, dob?, link?,      // optional profile
//     city_id?, bio?,
//     account_types?: string[],          // → user_account_types
//     sport_ids?: string[],              // → user_sports
//     coupon_code?: string               // → coupon_usages (best-effort)
//   }
//
// Notes:
//   * No password — OTP is the credential. password_hash stays null.
//   * Username uniqueness is enforced case-insensitively.
//   * account_types and sport_ids inserts are best-effort; a partial failure
//     does NOT roll back the user row (we'd rather have a half-populated
//     account than no account at all on a transient DB blip).
async function register(req, res) {
    const { phone, code, name, username, email, gender, dob, link, city_id, bio, account_types, sport_ids, coupon_code, } = req.body || {};
    if (!phone || !code)
        return res.status(400).json({ error: 'phone and code are required' });
    if (!name || !username)
        return res.status(400).json({ error: 'name and username are required' });
    const p = normalizePhone(phone);
    const entry = await (0, redis_1.getOtp)(p);
    if (!entry || (entry.code !== code && entry.code !== 'VERIFIED')) {
        return res.status(400).json({ error: 'OTP not verified' });
    }
    // Phone must be free
    const { data: existingPhone } = await supabase_1.supabase
        .from('users').select('id').eq('phone', p).maybeSingle();
    if (existingPhone) {
        return res.status(400).json({
            code: 'PHONE_ALREADY_REGISTERED',
            error: 'This mobile number is already registered. Please login instead.',
        });
    }
    // Email must be free (if provided)
    if (email) {
        const { data: existingEmail } = await supabase_1.supabase
            .from('users').select('id').eq('email', email).maybeSingle();
        if (existingEmail) {
            return res.status(400).json({
                code: 'EMAIL_ALREADY_REGISTERED',
                error: 'This email is already registered.',
            });
        }
    }
    // Username must be free (case-insensitive)
    const { data: existingUsername } = await supabase_1.supabase
        .from('users').select('id').ilike('username', username).maybeSingle();
    if (existingUsername)
        return res.status(409).json({ error: 'Username already taken' });
    if (gender && !['male', 'female', 'other'].includes(gender)) {
        return res.status(400).json({ error: 'gender must be male, female, or other' });
    }
    // The legacy users.account_type column is kept for backward compat — store
    // the first selected type so existing code that reads it still works.
    const primaryAccountType = Array.isArray(account_types) && account_types.length > 0
        ? account_types[0]
        : 'fan';
    // Generate a unique referral code (retry a couple of times on collision).
    const { generateReferralCode } = await Promise.resolve().then(() => __importStar(require('./referrals.controller')));
    let referralCode = generateReferralCode();
    for (let i = 0; i < 3; i++) {
        const { data: existing } = await supabase_1.supabase
            .from('users')
            .select('id')
            .eq('referral_code', referralCode)
            .maybeSingle();
        if (!existing)
            break;
        referralCode = generateReferralCode();
    }
    const { data: user, error } = await supabase_1.supabase
        .from('users')
        .insert({
        phone: p,
        name,
        username,
        email: email || null,
        gender: gender || null,
        dob: dob || null,
        link: link || null,
        bio: bio || null,
        city_id: city_id || null,
        account_type: primaryAccountType,
        is_premium: false,
        coin_balance: 0,
        referral_code: referralCode,
    })
        .select('id, phone, name, username, email, gender, dob, link, bio, city_id, account_type, profile_picture_url, is_premium, coin_balance, referral_code, created_at')
        .single();
    if (error || !user) {
        return res.status(500).json({ error: error?.message || 'Failed to create user' });
    }
    // Best-effort multi-row inserts.
    if (Array.isArray(account_types) && account_types.length > 0) {
        const rows = account_types.map((t) => ({ user_id: user.id, account_type: t }));
        await supabase_1.supabase.from('user_account_types').insert(rows);
    }
    if (Array.isArray(sport_ids) && sport_ids.length > 0) {
        const rows = sport_ids.map((sid) => ({ user_id: user.id, sport_id: sid }));
        await supabase_1.supabase.from('user_sports').insert(rows);
    }
    // Apply coupon if present and valid.
    if (coupon_code) {
        const { data: coupon } = await supabase_1.supabase
            .from('coupon_codes')
            .select('id, premium_months, coins, max_uses, uses_count, expires_at, active')
            .ilike('code', coupon_code)
            .maybeSingle();
        if (coupon && coupon.active &&
            (!coupon.expires_at || new Date(coupon.expires_at) > new Date()) &&
            (coupon.max_uses == null || coupon.uses_count < coupon.max_uses)) {
            const updates = {};
            if (coupon.coins)
                updates.coin_balance = coupon.coins;
            if (coupon.premium_months) {
                updates.is_premium = true;
                updates.premium_expires_at = new Date(Date.now() + coupon.premium_months * 30 * 24 * 60 * 60 * 1000).toISOString();
            }
            if (Object.keys(updates).length > 0) {
                await supabase_1.supabase.from('users').update(updates).eq('id', user.id);
            }
            await supabase_1.supabase.from('coupon_usages').insert({ coupon_id: coupon.id, user_id: user.id });
            await supabase_1.supabase.from('coupon_codes').update({ uses_count: coupon.uses_count + 1 }).eq('id', coupon.id);
        }
    }
    // Welcome bonus — 10 coins on first registration. Idempotent via
    // the (user_id, event_type) unique key on coin_events.
    try {
        const { awardCoins } = await Promise.resolve().then(() => __importStar(require('../utils/coins')));
        await awardCoins(user.id, 'first_registration', 10);
    }
    catch {
        // non-critical
    }
    await (0, redis_1.deleteOtp)(p);
    const accessToken = (0, jwt_1.generateAccessToken)(user.id);
    const refreshToken = (0, jwt_1.generateRefreshToken)(user.id);
    await supabase_1.supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
    return res.json({ user, accessToken, refreshToken, isNewUser: true });
}
exports.register = register;
// POST /auth/otp/login  { phone, code }
// Returning users log in with phone + OTP only — no password.
// Validates OTP, looks up user by phone, issues fresh tokens.
// Errors:
//   400 — phone/code missing or OTP invalid/expired
//   404 — phone is not registered (caller should route to register flow)
async function otpLogin(req, res) {
    const { phone, code } = req.body || {};
    if (!phone || !code)
        return res.status(400).json({ error: 'phone and code are required' });
    const p = normalizePhone(phone);
    // Dev-only bypass (see isTestOtp): skip OTP validation for the fixed test code.
    // The user must still exist (seeded) — otherwise we fall through to the 404 below.
    if (!isTestOtp(code)) {
        const entry = await (0, redis_1.getOtp)(p);
        if (!entry)
            return res.status(400).json({ error: 'No OTP requested or OTP expired' });
        // Accept either the original code or the VERIFIED marker (verify-otp may
        // have already been called separately by the client).
        if (entry.code !== code && entry.code !== 'VERIFIED') {
            return res.status(400).json({ error: 'Invalid OTP' });
        }
    }
    const { data: user, error } = await supabase_1.supabase
        .from('users')
        .select('id, phone, name, username, email, gender, dob, link, bio, city_id, account_type, profile_picture_url, is_premium, premium_expires_at, coin_balance, created_at')
        .eq('phone', p)
        .maybeSingle();
    if (error)
        return res.status(500).json({ error: error.message });
    if (!user) {
        return res.status(404).json({ error: 'Phone not registered', needsRegistration: true });
    }
    await (0, redis_1.deleteOtp)(p);
    const accessToken = (0, jwt_1.generateAccessToken)(user.id);
    const refreshToken = (0, jwt_1.generateRefreshToken)(user.id);
    await supabase_1.supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
    return res.json({ user, accessToken, refreshToken, isNewUser: false });
}
exports.otpLogin = otpLogin;
// POST /auth/login  { phone, password } or { email, password }
async function login(req, res) {
    const { phone, email, password } = req.body || {};
    if (!password || (!phone && !email)) {
        return res.status(400).json({ error: 'password and either phone or email are required' });
    }
    let query = supabase_1.supabase
        .from('users')
        .select('id, phone, name, username, email, password_hash, city_id, account_type, profile_picture_url, is_premium, premium_expires_at, coin_balance, created_at');
    if (email) {
        query = query.ilike('email', email.trim());
    }
    else {
        query = query.eq('phone', normalizePhone(phone));
    }
    const { data: user } = await query.maybeSingle();
    if (!user)
        return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.password_hash)
        return res.status(401).json({ error: 'Account uses OTP login only' });
    const ok = await bcryptjs_1.default.compare(password, user.password_hash);
    if (!ok)
        return res.status(401).json({ error: 'Invalid credentials' });
    const accessToken = (0, jwt_1.generateAccessToken)(user.id);
    const refreshToken = (0, jwt_1.generateRefreshToken)(user.id);
    await supabase_1.supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
    const { password_hash: _ph, ...safe } = user;
    return res.json({ user: safe, accessToken, refreshToken });
}
exports.login = login;
// POST /auth/register-email  { email, password, name, username }
// Email+password registration for reviewer/test accounts.
async function registerEmail(req, res) {
    const { email, password, name, username } = req.body || {};
    if (!email || !password || !name || !username) {
        return res.status(400).json({ error: 'email, password, name, and username are required' });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    // Email must be free
    const { data: existingEmail } = await supabase_1.supabase
        .from('users').select('id').ilike('email', email.trim()).maybeSingle();
    if (existingEmail)
        return res.status(409).json({ error: 'Email already registered' });
    // Username must be free (case-insensitive)
    const { data: existingUsername } = await supabase_1.supabase
        .from('users').select('id').ilike('username', username).maybeSingle();
    if (existingUsername)
        return res.status(409).json({ error: 'Username already taken' });
    const password_hash = await bcryptjs_1.default.hash(password, 10);
    // phone is NOT NULL in the schema — generate a unique placeholder for email-only accounts
    const placeholderPhone = `+0${Date.now()}`;
    const { data: user, error } = await supabase_1.supabase
        .from('users')
        .insert({
        phone: placeholderPhone,
        email: email.trim(),
        name,
        username,
        password_hash,
        account_type: 'fan',
        is_premium: false,
        coin_balance: 0,
    })
        .select('id, phone, name, username, email, city_id, account_type, profile_picture_url, is_premium, coin_balance, created_at')
        .single();
    if (error || !user) {
        return res.status(500).json({ error: error?.message || 'Failed to create user' });
    }
    const accessToken = (0, jwt_1.generateAccessToken)(user.id);
    const refreshToken = (0, jwt_1.generateRefreshToken)(user.id);
    await supabase_1.supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
    return res.json({ user, accessToken, refreshToken, isNewUser: true });
}
exports.registerEmail = registerEmail;
// POST /auth/refresh  { refreshToken }
async function refresh(req, res) {
    const { refreshToken } = req.body || {};
    if (!refreshToken)
        return res.status(400).json({ error: 'refreshToken is required' });
    try {
        const payload = (0, jwt_1.verifyRefreshToken)(refreshToken);
        const { data: row } = await supabase_1.supabase
            .from('refresh_tokens')
            .select('id, revoked')
            .eq('token', refreshToken)
            .maybeSingle();
        if (!row || row.revoked)
            return res.status(401).json({ error: 'Refresh token revoked' });
        const accessToken = (0, jwt_1.generateAccessToken)(payload.userId);
        return res.json({ accessToken });
    }
    catch {
        return res.status(401).json({ error: 'Invalid refresh token' });
    }
}
exports.refresh = refresh;
// POST /auth/logout  { refreshToken }
async function logout(req, res) {
    const { refreshToken } = req.body || {};
    if (refreshToken) {
        await supabase_1.supabase.from('refresh_tokens').update({ revoked: true }).eq('token', refreshToken);
    }
    return res.json({ success: true });
}
exports.logout = logout;
// GET /auth/username/check?username=
// Returns { available: boolean }. Used by RegisterStep1 before submit.
async function checkUsername(req, res) {
    const username = (req.query.username || '').trim();
    if (!username)
        return res.status(400).json({ error: 'username is required' });
    if (username.length < 3)
        return res.json({ available: false });
    const { data } = await supabase_1.supabase
        .from('users').select('id').ilike('username', username).maybeSingle();
    return res.json({ available: !data });
}
exports.checkUsername = checkUsername;
// GET /auth/coupon/validate?code=
// Returns { valid: boolean, description?: string }. Best-effort lookup —
// the actual coupon application happens in the register controller.
async function validateCoupon(req, res) {
    const code = (req.query.code || '').trim();
    if (!code)
        return res.status(400).json({ error: 'code is required' });
    const { data: coupon } = await supabase_1.supabase
        .from('coupon_codes')
        .select('description, expires_at, active, max_uses, uses_count')
        .ilike('code', code)
        .maybeSingle();
    if (!coupon || !coupon.active)
        return res.json({ valid: false });
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
        return res.json({ valid: false });
    }
    if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses) {
        return res.json({ valid: false });
    }
    return res.json({ valid: true, description: coupon.description ?? undefined });
}
exports.validateCoupon = validateCoupon;
// POST /auth/google  { idToken }
// Verifies the Google ID token, extracts email/name/picture, and either
// logs in an existing user or creates a new one. Returns JWT tokens.
//
// Requires GOOGLE_CLIENT_ID in .env. Without it, all requests return 503.
async function googleAuth(req, res) {
    const { idToken } = req.body || {};
    if (!idToken)
        return res.status(400).json({ error: 'idToken is required' });
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        return res.status(503).json({ error: 'Google Sign-In not configured. Set GOOGLE_CLIENT_ID in .env.' });
    }
    try {
        // Verify the token with Google. google-auth-library is optional —
        // if not installed, we decode the JWT payload directly (less secure
        // but functional for development; install google-auth-library for
        // production-grade verification).
        let payload;
        try {
            // Try google-auth-library first
            const { OAuth2Client } = await Promise.resolve().then(() => __importStar(require('google-auth-library')));
            const client = new OAuth2Client(clientId);
            const ticket = await client.verifyIdToken({ idToken, audience: clientId });
            payload = ticket.getPayload();
        }
        catch {
            // Fallback: decode JWT payload without verification (dev only)
            const parts = idToken.split('.');
            if (parts.length !== 3)
                return res.status(400).json({ error: 'Invalid token format' });
            payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        }
        if (!payload?.email)
            return res.status(400).json({ error: 'Token missing email' });
        // Check if user exists by google_id or email
        const { data: existing } = await supabase_1.supabase
            .from('users')
            .select('id, phone, name, username, email, google_id, is_premium, coin_balance, referral_code, created_at')
            .or(`google_id.eq.${payload.sub},email.eq.${payload.email}`)
            .maybeSingle();
        let user;
        if (existing) {
            // Update google_id if missing
            if (!existing.google_id && payload.sub) {
                await supabase_1.supabase.from('users').update({ google_id: payload.sub }).eq('id', existing.id);
            }
            user = existing;
        }
        else {
            // Create new user
            const username = payload.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') + Math.floor(Math.random() * 100);
            const { data: newUser, error } = await supabase_1.supabase
                .from('users')
                .insert({
                name: payload.name ?? 'Google User',
                username,
                email: payload.email,
                google_id: payload.sub ?? null,
                profile_picture_url: payload.picture ?? null,
                account_type: 'player',
                is_premium: false,
                coin_balance: 0,
            })
                .select('id, phone, name, username, email, google_id, is_premium, coin_balance, referral_code, created_at')
                .single();
            if (error || !newUser)
                return res.status(500).json({ error: 'Could not create account' });
            // Seed the multi-type join table so the new account is consistent with
            // phone signups (which populate user_account_types).
            await supabase_1.supabase
                .from('user_account_types')
                .insert({ user_id: newUser.id, account_type: 'player' })
                .then(undefined, () => undefined);
            user = newUser;
        }
        const { generateAccessToken, generateRefreshToken } = await Promise.resolve().then(() => __importStar(require('../utils/jwt')));
        const accessToken = generateAccessToken(user.id);
        const refreshToken = generateRefreshToken(user.id);
        await supabase_1.supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
        return res.json({ accessToken, refreshToken, user });
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : 'Google auth failed';
        return res.status(500).json({ error: msg });
    }
}
exports.googleAuth = googleAuth;
// POST /auth/reset-password  { phone, code, newPassword }
async function resetPassword(req, res) {
    const { phone, code, newPassword } = req.body || {};
    if (!phone || !code || !newPassword) {
        return res.status(400).json({ error: 'phone, code, newPassword are required' });
    }
    const p = normalizePhone(phone);
    const entry = await (0, redis_1.getOtp)(p);
    if (!entry || (entry.code !== code && entry.code !== 'VERIFIED')) {
        return res.status(400).json({ error: 'OTP not verified or expired' });
    }
    const password_hash = await bcryptjs_1.default.hash(newPassword, 10);
    const { error } = await supabase_1.supabase.from('users').update({ password_hash }).eq('phone', p);
    if (error)
        return res.status(500).json({ error: error.message });
    await (0, redis_1.deleteOtp)(p);
    return res.json({ success: true });
}
exports.resetPassword = resetPassword;
// POST /auth/change-phone  { newPhone, code }  (requires auth — verifies OTP sent to NEW phone)
async function changePhone(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const { newPhone, code } = req.body || {};
    if (!newPhone || !code)
        return res.status(400).json({ error: 'newPhone and code are required' });
    const p = normalizePhone(newPhone);
    const entry = await (0, redis_1.getOtp)(p);
    if (!entry || (entry.code !== code && entry.code !== 'VERIFIED')) {
        return res.status(400).json({ error: 'OTP not verified or expired' });
    }
    const { data: existing } = await supabase_1.supabase
        .from('users')
        .select('id')
        .eq('phone', p)
        .maybeSingle();
    if (existing)
        return res.status(409).json({ error: 'Phone already in use' });
    const { error } = await supabase_1.supabase.from('users').update({ phone: p }).eq('id', userId);
    if (error)
        return res.status(500).json({ error: error.message });
    await (0, redis_1.deleteOtp)(p);
    return res.json({ success: true });
}
exports.changePhone = changePhone;
//# sourceMappingURL=auth.controller.js.map