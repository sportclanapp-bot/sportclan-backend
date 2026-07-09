import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import axios from 'axios';
import { supabase } from '../utils/supabase';
import { isValidIndianPhone } from '../utils/phone';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../utils/jwt';
import { setOtp, getOtp, deleteOtp } from '../utils/redis';
import { normalizeAccountTypes } from '../constants/accountTypes';
import { awardCoins } from '../utils/coins';

// Purchases kill-switch (mirrors subscriptions.controller). Register-time coupon
// redemption grants premium + coins for ₹0, so it stays OFF until a real gateway
// is wired (A4-003). Premium is complimentary via the early-bird grant meanwhile.
const PAYMENTS_ENABLED = process.env.PAYMENTS_ENABLED === 'true';


const OTP_TTL_SECONDS = 300; // 5 minutes

// ─── Early-bird launch perk ──────────────────────────────────────────────────
// Every NEW signup (any path: phone, email, Google) is granted Premium for
// 3 calendar months + 50 coins, using the real premium machinery
// (is_premium=true + premium_expires_at). This replaces the retired EARLYBIRDS
// coupon. Premium is set in the user INSERT (so it only applies to brand-new
// rows — existing users logging in are untouched). The 50 coins are awarded
// via awardCoins('early_bird_grant') which is idempotent (unique coin_events
// key) and logs a transaction — so it can never double-grant.
const EARLY_BIRD_PREMIUM_MONTHS = 3;
const EARLY_BIRD_COINS = 50;

/** premium_expires_at = `from` + 3 calendar months, as an ISO string. */
function earlyBirdExpiry(from: Date = new Date()): string {
  const d = new Date(from);
  d.setMonth(d.getMonth() + EARLY_BIRD_PREMIUM_MONTHS);
  return d.toISOString();
}

/** Award the 50-coin early-bird grant to a freshly-created user. Best-effort. */
async function grantEarlyBirdCoins(userId: string): Promise<void> {
  try {
    await awardCoins(userId, 'early_bird_grant', EARLY_BIRD_COINS);
  } catch {
    // non-critical — premium is already set on the row
  }
}

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
function isTestOtp(code: string): boolean {
  return (
    process.env.ALLOW_TEST_OTP === 'true' &&
    process.env.NODE_ENV !== 'production' &&
    code === TEST_OTP_CODE
  );
}

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function normalizePhone(phone: string): string {
  return phone.trim().replace(/\s+/g, '');
}

// Send OTP via 2Factor.in — choose between voice call and WhatsApp.
// Voice is the default (per product spec for India to dodge SMS deliverability).
// WhatsApp is the fallback when voice fails (carrier block, SIM issue, voice
// rate limits). On dev with no API key, both fall through to console.
async function sendOtpViaChannel(
  phone: string,
  code: string,
  channel: 'voice' | 'whatsapp',
): Promise<boolean> {
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
      await axios.get(url, { timeout: 8000 }); // SC-150: fail fast if 2Factor.in hangs
      return true;
    }
    // Voice call (default)
    const url = `https://2factor.in/API/V1/${apiKey}/VOICE/${cleanPhone}/${code}`;
    await axios.get(url, { timeout: 8000 }); // SC-150: fail fast if 2Factor.in hangs
    return true;
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error(`[2Factor.in] ${channel} send failed:`, err?.message);
    return false;
  }
}

// Legacy alias retained so other call sites don't break
async function sendSmsOtp(phone: string, code: string): Promise<boolean> {
  return sendOtpViaChannel(phone, code, 'voice');
}

// POST /auth/send-otp  { phone, purpose?, channel? }
export async function sendOtp(req: Request, res: Response) {
  const { phone, purpose = 'login', channel: rawChannel } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone is required' });
  const channel: 'voice' | 'whatsapp' =
    rawChannel === 'whatsapp' ? 'whatsapp' : 'voice';
  const p = normalizePhone(phone);
  const code = generateOtp();

  await setOtp(p, code, purpose, OTP_TTL_SECONDS);

  const sent = await sendOtpViaChannel(p, code, channel);
  if (!sent) {
    return res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
  }
  return res.json({ success: true, message: 'OTP sent', channel });
}

// Best-effort suspension check used by all login paths. Tolerates the
// suspended_at column not existing yet (pre-migration 029) by treating any
// query error as "not suspended", so login never breaks on a missing column.
async function isSuspended(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('users').select('suspended_at').eq('id', userId).maybeSingle();
    if (error) return false;
    return !!(data && (data as { suspended_at?: string | null }).suspended_at);
  } catch {
    return false;
  }
}

/** True once an account has been soft-deleted via POST /account/delete
 * (deleted_at set). Deletion is FINAL — a deleted account cannot be logged into
 * (its data is scrubbed and it is purged after the 30-day grace). Mirrors
 * isSuspended, including the fail-open on a transient DB error. */
async function isDeleted(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('users').select('deleted_at').eq('id', userId).maybeSingle();
    if (error) return false;
    return !!(data && (data as { deleted_at?: string | null }).deleted_at);
  } catch {
    return false;
  }
}

// POST /auth/verify-otp  { phone, code }
export async function verifyOtp(req: Request, res: Response) {
  const { phone, code } = req.body || {};
  if (!phone || !code) return res.status(400).json({ error: 'phone and code are required' });
  const p = normalizePhone(phone);
  // Dev-only bypass (see isTestOtp): accept the fixed test code without a real OTP.
  if (isTestOtp(code)) {
    await setOtp(p, 'VERIFIED', 'login', OTP_TTL_SECONDS);
    return res.json({ success: true, verified: true });
  }
  const entry = await getOtp(p);
  if (!entry) return res.status(400).json({ error: 'No OTP requested or OTP expired' });
  if (entry.code !== code) return res.status(400).json({ error: 'Invalid OTP' });
  // Mark verified — store VERIFIED with fresh TTL
  await setOtp(p, 'VERIFIED', entry.purpose, OTP_TTL_SECONDS);
  return res.json({ success: true, verified: true });
}

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
export async function register(req: Request, res: Response) {
  const {
    phone, code,
    name, username, email, gender, dob, link, city_id, bio,
    account_types, sport_ids, coupon_code,
  } = req.body || {};

  if (!phone || !code) return res.status(400).json({ error: 'phone and code are required' });
  if (!name || !username) return res.status(400).json({ error: 'name and username are required' });

  const p = normalizePhone(phone);
  // SC-72: reject a malformed phone up front so no account is created for junk
  // like "12"/letters/too-short/too-long. Mirrors the client-side check.
  if (!isValidIndianPhone(p)) {
    return res.status(400).json({
      error: 'Enter a valid 10-digit Indian mobile number.',
      code: 'INVALID_PHONE',
    });
  }
  // Honor the dev-only test bypass exactly as verifyOtp does: when ALLOW_TEST_OTP
  // is on and the fixed test code is used, sendOtp has stored the *real* voice
  // code (not 123456), so the entry.code check below would always fail. Skip it.
  // In production isTestOtp() is always false, so the real OTP check still runs.
  if (!isTestOtp(code)) {
    const entry = await getOtp(p);
    if (!entry || (entry.code !== code && entry.code !== 'VERIFIED')) {
      return res.status(400).json({ error: 'OTP not verified' });
    }
  }

  // Phone must be free — EXCEPT a soft-deleted account still holds its phone.
  // Deletion is final (the old account is gone, not restorable), so we let the
  // number be reused for a BRAND-NEW signup instead of stranding the user
  // ("can't log in AND can't re-register"). Release the phone from the dead row
  // first; that row keeps its content + deleted_at and is hard-purged after the
  // 30-day grace.
  const { data: existingPhone } = await supabase
    .from('users').select('id, deleted_at').eq('phone', p).maybeSingle();
  if (existingPhone) {
    if ((existingPhone as { deleted_at?: string | null }).deleted_at) {
      const { error: freeErr } = await supabase
        .from('users')
        .update({ phone: `deleted:${existingPhone.id}` })
        .eq('id', existingPhone.id);
      if (freeErr) return res.status(500).json({ error: 'Could not free the number for re-registration' });
    } else {
      return res.status(400).json({
        code: 'PHONE_ALREADY_REGISTERED',
        error: 'This mobile number is already registered. Please login instead.',
      });
    }
  }

  // Email must be free (if provided)
  if (email) {
    const { data: existingEmail } = await supabase
      .from('users').select('id').eq('email', email).maybeSingle();
    if (existingEmail) {
      return res.status(400).json({
        code: 'EMAIL_ALREADY_REGISTERED',
        error: 'This email is already registered.',
      });
    }
  }

  // Username must be free (case-insensitive)
  const { data: existingUsername } = await supabase
    .from('users').select('id').ilike('username', username).maybeSingle();
  if (existingUsername) return res.status(409).json({ error: 'Username already taken' });

  if (gender && !['male', 'female', 'other'].includes(gender)) {
    return res.status(400).json({ error: 'gender must be male, female, or other' });
  }

  // Validate + normalize account types against the shared whitelist — the same
  // contract PATCH /users/me/account-types enforces (lowercased, de-duped,
  // invalid dropped, 'player' first). Empty/garbage input falls back to
  // ['player']. (Registration previously stored the raw client strings
  // unvalidated and defaulted to the non-canonical 'fan'.)
  const normalizedAccountTypes = normalizeAccountTypes(account_types);
  // The legacy users.account_type column is kept for backward compat — store
  // the primary (first) type so existing code that reads it still works.
  const primaryAccountType = normalizedAccountTypes[0];

  // Generate a unique referral code (retry a couple of times on collision).
  const { generateReferralCode } = await import('./referrals.controller');
  let referralCode = generateReferralCode();
  for (let i = 0; i < 3; i++) {
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('referral_code', referralCode)
      .maybeSingle();
    if (!existing) break;
    referralCode = generateReferralCode();
  }

  const { data: user, error } = await supabase
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
      is_premium: true,
      premium_expires_at: earlyBirdExpiry(),
      coin_balance: 0,
      referral_code: referralCode,
    })
    .select('id, phone, name, username, email, gender, dob, link, bio, city_id, account_type, profile_picture_url, is_premium, premium_expires_at, coin_balance, referral_code, created_at')
    .single();
  if (error || !user) {
    return res.status(500).json({ error: error?.message || 'Failed to create user' });
  }

  // Best-effort multi-row inserts.
  {
    const rows = normalizedAccountTypes.map((t) => ({ user_id: user.id, account_type: t }));
    await supabase.from('user_account_types').insert(rows);
  }
  if (Array.isArray(sport_ids) && sport_ids.length > 0) {
    const rows = sport_ids.map((sid: string) => ({ user_id: user.id, sport_id: sid }));
    await supabase.from('user_sports').insert(rows);
  }

  // Apply coupon if present and valid. Gated by the purchases kill-switch
  // (A4-003) — while payments are off the coupon is silently ignored rather
  // than self-granting premium for free. Registration itself still succeeds.
  if (coupon_code && PAYMENTS_ENABLED) {
    const { data: coupon } = await supabase
      .from('coupon_codes')
      .select('id, premium_months, coins, max_uses, uses_count, expires_at, active')
      .ilike('code', coupon_code)
      .maybeSingle();
    if (coupon && coupon.active &&
        (!coupon.expires_at || new Date(coupon.expires_at) > new Date()) &&
        (coupon.max_uses == null || coupon.uses_count < coupon.max_uses)) {
      const updates: Record<string, unknown> = {};
      if (coupon.coins) updates.coin_balance = coupon.coins;
      if (coupon.premium_months) {
        updates.is_premium = true;
        // Calendar months, consistent with earlyBirdExpiry (A4-011).
        const exp = new Date();
        exp.setMonth(exp.getMonth() + coupon.premium_months);
        updates.premium_expires_at = exp.toISOString();
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from('users').update(updates).eq('id', user.id);
      }
      await supabase.from('coupon_usages').insert({ coupon_id: coupon.id, user_id: user.id });
      await supabase.from('coupon_codes').update({ uses_count: coupon.uses_count + 1 }).eq('id', coupon.id);
    }
  }

  // Welcome bonus — 10 coins on first registration. Idempotent via
  // the (user_id, event_type) unique key on coin_events.
  try {
    await awardCoins(user.id, 'first_registration', 10);
  } catch {
    // non-critical
  }

  // Early-bird launch perk: 50 coins (premium was set on the insert above).
  await grantEarlyBirdCoins(user.id);

  await deleteOtp(p);
  // The `user` row was captured BEFORE the coin grants ran, so its coin_balance
  // is still 0 — re-read it so the signup response reflects the real total (A4-009).
  {
    const { data: fb } = await supabase
      .from('users').select('coin_balance, is_premium, premium_expires_at').eq('id', user.id).maybeSingle();
    if (fb) Object.assign(user, fb);
  }
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
  return res.json({ user, accessToken, refreshToken, isNewUser: true, earlyBird: true });
}

// POST /auth/otp/login  { phone, code }
// Returning users log in with phone + OTP only — no password.
// Validates OTP, looks up user by phone, issues fresh tokens.
// Errors:
//   400 — phone/code missing or OTP invalid/expired
//   404 — phone is not registered (caller should route to register flow)
export async function otpLogin(req: Request, res: Response) {
  const { phone, code } = req.body || {};
  if (!phone || !code) return res.status(400).json({ error: 'phone and code are required' });
  const p = normalizePhone(phone);
  // Dev-only bypass (see isTestOtp): skip OTP validation for the fixed test code.
  // The user must still exist (seeded) — otherwise we fall through to the 404 below.
  if (!isTestOtp(code)) {
    const entry = await getOtp(p);
    if (!entry) return res.status(400).json({ error: 'No OTP requested or OTP expired' });
    // Accept either the original code or the VERIFIED marker (verify-otp may
    // have already been called separately by the client).
    if (entry.code !== code && entry.code !== 'VERIFIED') {
      return res.status(400).json({ error: 'Invalid OTP' });
    }
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, phone, name, username, email, gender, dob, link, bio, city_id, account_type, profile_picture_url, is_premium, premium_expires_at, coin_balance, is_admin, created_at')
    .eq('phone', p)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!user) {
    return res.status(404).json({ error: 'Phone not registered', needsRegistration: true });
  }
  if (await isSuspended(user.id)) {
    return res.status(403).json({ error: 'This account has been suspended. Please contact support.' });
  }
  if (await isDeleted(user.id)) {
    return res.status(403).json({ error: 'This account has been deleted.' });
  }

  await deleteOtp(p);
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
  return res.json({ user, accessToken, refreshToken, isNewUser: false });
}

// POST /auth/login  { phone, password } or { email, password }
export async function login(req: Request, res: Response) {
  const { phone, email, password } = req.body || {};
  if (!password || (!phone && !email)) {
    return res.status(400).json({ error: 'password and either phone or email are required' });
  }

  let query = supabase
    .from('users')
    .select('id, phone, name, username, email, password_hash, city_id, account_type, profile_picture_url, is_premium, premium_expires_at, coin_balance, is_admin, created_at');

  if (email) {
    query = query.ilike('email', email.trim());
  } else {
    query = query.eq('phone', normalizePhone(phone));
  }

  const { data: user } = await query.maybeSingle();
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.password_hash) return res.status(401).json({ error: 'Account uses OTP login only' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  if (await isSuspended(user.id)) {
    return res.status(403).json({ error: 'This account has been suspended. Please contact support.' });
  }
  if (await isDeleted(user.id)) {
    return res.status(403).json({ error: 'This account has been deleted.' });
  }
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
  const { password_hash: _ph, ...safe } = user;
  return res.json({ user: safe, accessToken, refreshToken });
}

// POST /auth/register-email
//   { email, password, name, username,
//     gender?, dob?, link?, city_id?, bio?, account_types?, sport_ids? }
// Email+password registration. This is now a first-class signup path (not just
// for reviewer/test accounts) so the onboarding flow is reachable without a
// verified phone — phone-OTP signup is the primary path but OTP delivery is a
// known launch gate, and email signup unblocks onboarding regardless (A1-003).
export async function registerEmail(req: Request, res: Response) {
  const {
    email, password, name, username,
    gender, dob, link, city_id, bio, account_types, sport_ids,
  } = req.body || {};
  if (!email || !password || !name || !username) {
    return res.status(400).json({ error: 'email, password, name, and username are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (gender && !['male', 'female', 'other'].includes(gender)) {
    return res.status(400).json({ error: 'gender must be male, female, or other' });
  }

  // Email must be free
  const { data: existingEmail } = await supabase
    .from('users').select('id').ilike('email', email.trim()).maybeSingle();
  if (existingEmail) return res.status(409).json({ error: 'Email already registered' });

  // Username must be free (case-insensitive)
  const { data: existingUsername } = await supabase
    .from('users').select('id').ilike('username', username).maybeSingle();
  if (existingUsername) return res.status(409).json({ error: 'Username already taken' });

  const password_hash = await bcrypt.hash(password, 10);

  // Validate + normalize account types against the shared whitelist — same
  // contract as phone register and PATCH /users/me/account-types. Empty/garbage
  // falls back to ['player']. (Previously this path hardcoded the non-canonical
  // 'fan' and skipped the join table — see A6-001.)
  const normalizedAccountTypes = normalizeAccountTypes(account_types);
  const primaryAccountType = normalizedAccountTypes[0];

  // Generate a unique referral code (retry a couple of times on collision),
  // matching the phone-register path so invite-a-friend works for email users.
  const { generateReferralCode } = await import('./referrals.controller');
  let referralCode = generateReferralCode();
  for (let i = 0; i < 3; i++) {
    const { data: existing } = await supabase
      .from('users').select('id').eq('referral_code', referralCode).maybeSingle();
    if (!existing) break;
    referralCode = generateReferralCode();
  }

  // phone is NOT NULL in the schema — generate a unique placeholder for email-only accounts
  const placeholderPhone = `+0${Date.now()}`;

  const { data: user, error } = await supabase
    .from('users')
    .insert({
      phone: placeholderPhone,
      email: email.trim(),
      name,
      username,
      password_hash,
      gender: gender || null,
      dob: dob || null,
      link: link || null,
      bio: bio || null,
      city_id: city_id || null,
      account_type: primaryAccountType,
      is_premium: true,
      premium_expires_at: earlyBirdExpiry(),
      coin_balance: 0,
      referral_code: referralCode,
    })
    .select('id, phone, name, username, email, gender, dob, link, bio, city_id, account_type, profile_picture_url, is_premium, premium_expires_at, coin_balance, referral_code, created_at')
    .single();
  if (error || !user) {
    return res.status(500).json({ error: error?.message || 'Failed to create user' });
  }

  // Best-effort multi-row inserts (mirrors phone register).
  {
    const rows = normalizedAccountTypes.map((t) => ({ user_id: user.id, account_type: t }));
    await supabase.from('user_account_types').insert(rows);
  }
  if (Array.isArray(sport_ids) && sport_ids.length > 0) {
    const rows = sport_ids.map((sid: string) => ({ user_id: user.id, sport_id: sid }));
    await supabase.from('user_sports').insert(rows);
  }

  // Welcome bonus — 10 coins on first registration (parity with phone signup;
  // previously missing on email/Google, see A4-008). Idempotent via coin_events.
  try {
    await awardCoins(user.id, 'first_registration', 10);
  } catch {
    // non-critical
  }

  // Early-bird launch perk: 50 coins (premium set on the insert above).
  await grantEarlyBirdCoins(user.id);

  // Re-read post-grant balance so the response isn't a stale coin_balance:0 (A4-009).
  {
    const { data: fb } = await supabase
      .from('users').select('coin_balance, is_premium, premium_expires_at').eq('id', user.id).maybeSingle();
    if (fb) Object.assign(user, fb);
  }
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
  return res.json({ user, accessToken, refreshToken, isNewUser: true, earlyBird: true });
}

// POST /auth/refresh  { refreshToken }
export async function refresh(req: Request, res: Response) {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken is required' });
  try {
    const payload = verifyRefreshToken(refreshToken);
    const { data: row } = await supabase
      .from('refresh_tokens')
      .select('id, revoked')
      .eq('token', refreshToken)
      .maybeSingle();
    if (!row || row.revoked) return res.status(401).json({ error: 'Refresh token revoked' });
    const accessToken = generateAccessToken(payload.userId);
    return res.json({ accessToken });
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
}

// POST /auth/logout  { refreshToken }
export async function logout(req: Request, res: Response) {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    await supabase.from('refresh_tokens').update({ revoked: true }).eq('token', refreshToken);
  }
  return res.json({ success: true });
}

// GET /auth/username/check?username=
// Returns { available: boolean }. Used by RegisterStep1 before submit.
export async function checkUsername(req: Request, res: Response) {
  const username = ((req.query.username as string) || '').trim();
  if (!username) return res.status(400).json({ error: 'username is required' });
  if (username.length < 3) return res.json({ available: false });
  const { data } = await supabase
    .from('users').select('id').ilike('username', username).maybeSingle();
  return res.json({ available: !data });
}

// GET /auth/coupon/validate?code=
// Returns { valid: boolean, description?: string }. Best-effort lookup —
// the actual coupon application happens in the register controller.
// Codes that were intentionally RETIRED because their perk is now delivered
// automatically at signup (the early-bird auto-grant: 3 months premium + 50
// coins). The coupon_codes row is inactive/absent on purpose — DO NOT reactivate
// it (that would double-dip the auto-grant). We only give the UI an honest,
// specific message instead of a bare valid:false that reads as "invalid coupon".
// This grants NOTHING — it is a message only.
const RETIRED_COUPONS: Record<string, string> = {
  EARLYBIRDS: 'EarlyBirds is already applied automatically when you sign up — no code needed.',
};

export async function validateCoupon(req: Request, res: Response) {
  const code = ((req.query.code as string) || '').trim();
  if (!code) return res.status(400).json({ error: 'code is required' });
  const retiredMessage = RETIRED_COUPONS[code.toUpperCase()];
  const { data: coupon } = await supabase
    .from('coupon_codes')
    .select('description, expires_at, active, max_uses, uses_count')
    .ilike('code', code)
    .maybeSingle();
  if (!coupon || !coupon.active) {
    // A known-retired code (e.g. EARLYBIRDS) → honest "already included" state
    // rather than the generic invalid one, so the UI can reassure the user
    // instead of showing an error. Still valid:false → grants nothing.
    if (retiredMessage) {
      return res.json({ valid: false, reason: 'already_included', message: retiredMessage });
    }
    return res.json({ valid: false });
  }
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return res.json({ valid: false });
  }
  if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses) {
    return res.json({ valid: false });
  }
  return res.json({ valid: true, description: coupon.description ?? undefined });
}

// POST /auth/google  { idToken }
// Verifies the Google ID token, extracts email/name/picture, and either
// logs in an existing user or creates a new one. Returns JWT tokens.
//
// Requires GOOGLE_CLIENT_ID in .env. Without it, all requests return 503.
export async function googleAuth(req: Request, res: Response) {
  const { idToken } = req.body || {};
  if (!idToken) return res.status(400).json({ error: 'idToken is required' });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({ error: 'Google Sign-In not configured. Set GOOGLE_CLIENT_ID in .env.' });
  }

  try {
    // Verify the token with Google. google-auth-library is optional —
    // if not installed, we decode the JWT payload directly (less secure
    // but functional for development; install google-auth-library for
    // production-grade verification).
    // SC-149: verify the ID token cryptographically (signature + audience). There is
    // NO decode-without-verification fallback — a missing library or a failed
    // verification FAILS CLOSED. A missing crypto library must never downgrade to
    // "trust the input" (that let anyone forge a Google identity).
    let payload: { email?: string; name?: string; picture?: string; sub?: string };
    try {
      const { OAuth2Client } = await import('google-auth-library');
      const client = new OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload() as typeof payload;
    } catch (err: any) {
      const code = err?.code ?? '';
      if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND' || /Cannot find module/i.test(err?.message ?? '')) {
        // The verification library is unavailable — do NOT trust the token. Fail closed, loudly.
        // eslint-disable-next-line no-console
        console.error('[google-auth] google-auth-library unavailable — OAuth verification cannot run', err?.message);
        return res.status(503).json({ error: 'Google Sign-In temporarily unavailable' });
      }
      // Token failed verification (bad signature / audience / expiry) → reject.
      // eslint-disable-next-line no-console
      console.warn('[google-auth] ID token verification failed', err?.message);
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    if (!payload?.email) return res.status(400).json({ error: 'Token missing email' });

    // Check if user exists by google_id or email
    const { data: existing } = await supabase
      .from('users')
      .select('id, phone, name, username, email, google_id, is_premium, coin_balance, referral_code, created_at')
      .or(`google_id.eq.${payload.sub},email.eq.${payload.email}`)
      .maybeSingle();

    let user: Record<string, unknown>;

    if (existing) {
      // Update google_id if missing
      if (!existing.google_id && payload.sub) {
        await supabase.from('users').update({ google_id: payload.sub }).eq('id', existing.id);
      }
      user = existing;
    } else {
      // Create new user
      const username = payload.email!.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') + Math.floor(Math.random() * 100);
      const { data: newUser, error } = await supabase
        .from('users')
        .insert({
          name: payload.name ?? 'Google User',
          username,
          email: payload.email,
          google_id: payload.sub ?? null,
          profile_picture_url: payload.picture ?? null,
          account_type: 'player',
          is_premium: true,
          premium_expires_at: earlyBirdExpiry(),
          coin_balance: 0,
        })
        .select('id, phone, name, username, email, google_id, is_premium, premium_expires_at, coin_balance, referral_code, created_at')
        .single();
      if (error || !newUser) return res.status(500).json({ error: 'Could not create account' });
      // Welcome bonus — 10 coins on first registration, for parity with the
      // phone and email paths (Google previously got only the 50-coin early-bird
      // grant = 50 instead of 60, A4-008). Idempotent via coin_events.
      try {
        await awardCoins(newUser.id, 'first_registration', 10);
      } catch {
        // non-critical
      }
      // Early-bird launch perk: 50 coins (premium set on the insert above).
      await grantEarlyBirdCoins(newUser.id);
      // Seed the multi-type join table so the new account is consistent with
      // phone signups (which populate user_account_types).
      await supabase
        .from('user_account_types')
        .insert({ user_id: newUser.id, account_type: 'player' })
        .then(undefined, () => undefined);
      user = newUser;
    }

    const { generateAccessToken, generateRefreshToken } = await import('../utils/jwt');
    const accessToken = generateAccessToken(user.id as string);
    const refreshToken = generateRefreshToken(user.id as string);

    await supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });

    // New Google users had their grants applied after `user` was captured —
    // re-read so the response isn't a stale coin_balance:0 (A4-009).
    {
      const { data: fb } = await supabase
        .from('users').select('coin_balance, is_premium, premium_expires_at').eq('id', user.id as string).maybeSingle();
      if (fb) Object.assign(user, fb);
    }
    return res.json({ accessToken, refreshToken, user, isNewUser: !existing, earlyBird: !existing });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Google auth failed';
    return res.status(500).json({ error: msg });
  }
}

// POST /auth/reset-password  { phone, code, newPassword }
export async function resetPassword(req: Request, res: Response) {
  const { phone, code, newPassword } = req.body || {};
  if (!phone || !code || !newPassword) {
    return res.status(400).json({ error: 'phone, code, newPassword are required' });
  }
  const p = normalizePhone(phone);
  // Honor the dev-only test bypass uniformly with verifyOtp/otpLogin/register
  // (see isTestOtp). In production isTestOtp() is always false, so the real
  // OTP check still runs.
  if (!isTestOtp(code)) {
    const entry = await getOtp(p);
    if (!entry || (entry.code !== code && entry.code !== 'VERIFIED')) {
      return res.status(400).json({ error: 'OTP not verified or expired' });
    }
  }
  const password_hash = await bcrypt.hash(newPassword, 10);
  const { error } = await supabase.from('users').update({ password_hash }).eq('phone', p);
  if (error) return res.status(500).json({ error: error.message });
  await deleteOtp(p);
  return res.json({ success: true });
}

// POST /auth/change-phone  { newPhone, code }  (requires auth — verifies OTP sent to NEW phone)
export async function changePhone(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { newPhone, code } = req.body || {};
  if (!newPhone || !code) return res.status(400).json({ error: 'newPhone and code are required' });
  const p = normalizePhone(newPhone);
  // Honor the dev-only test bypass uniformly (see isTestOtp). Production runs
  // the real OTP check since isTestOtp() is always false there.
  if (!isTestOtp(code)) {
    const entry = await getOtp(p);
    if (!entry || (entry.code !== code && entry.code !== 'VERIFIED')) {
      return res.status(400).json({ error: 'OTP not verified or expired' });
    }
  }
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('phone', p)
    .maybeSingle();
  if (existing) return res.status(409).json({ error: 'Phone already in use' });
  const { error } = await supabase.from('users').update({ phone: p }).eq('id', userId);
  if (error) return res.status(500).json({ error: error.message });
  await deleteOtp(p);
  return res.json({ success: true });
}
