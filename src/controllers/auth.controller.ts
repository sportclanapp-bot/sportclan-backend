import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import axios from 'axios';
import { supabase } from '../utils/supabase';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../utils/jwt';

// In-memory OTP store for dev — replace with Redis/Twilio in a later part.
// Map<phone, { code, expiresAt, purpose }>
type OtpPurpose = 'login' | 'register' | 'reset' | 'change_phone';
interface OtpEntry {
  code: string;
  expiresAt: number;
  purpose: OtpPurpose;
}
const otpStore = new Map<string, OtpEntry>();

const OTP_TTL_MS = 5 * 60 * 1000;

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function normalizePhone(phone: string): string {
  return phone.trim().replace(/\s+/g, '');
}

// Send SMS via 2Factor.in API
async function sendSmsOtp(phone: string, code: string): Promise<boolean> {
  const apiKey = process.env.TWOFACTOR_API_KEY;
  if (!apiKey) {
    // Fallback to console in dev when API key is not configured
    // eslint-disable-next-line no-console
    console.log(`[OTP DEV] phone=${phone} code=${code}`);
    return true;
  }
  try {
    // 2Factor.in SMS OTP API — phone must be 10-digit Indian number or with +91 prefix
    const cleanPhone = phone.replace(/^\+91/, '');
    const url = `https://2factor.in/API/V1/${apiKey}/VOICE/${cleanPhone}/${code}`;
    const { data } = await axios.get(url);
    return true;
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('[2Factor.in] SMS send failed:', err?.message);
    return false;
  }
}

// POST /auth/send-otp  { phone, purpose? }
export async function sendOtp(req: Request, res: Response) {
  const { phone, purpose = 'login' } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone is required' });
  const p = normalizePhone(phone);
  const code = generateOtp();
  otpStore.set(p, { code, expiresAt: Date.now() + OTP_TTL_MS, purpose });

  const sent = await sendSmsOtp(p, code);
  if (!sent) {
    return res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
  }
  return res.json({ success: true, message: 'OTP sent' });
}

// POST /auth/verify-otp  { phone, code }
export async function verifyOtp(req: Request, res: Response) {
  const { phone, code } = req.body || {};
  if (!phone || !code) return res.status(400).json({ error: 'phone and code are required' });
  const p = normalizePhone(phone);
  const entry = otpStore.get(p);
  if (!entry) return res.status(400).json({ error: 'No OTP requested' });
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(p);
    return res.status(400).json({ error: 'OTP expired' });
  }
  if (entry.code !== code) return res.status(400).json({ error: 'Invalid OTP' });
  // Mark verified by re-storing with a short verified window
  otpStore.set(p, { ...entry, code: 'VERIFIED', expiresAt: Date.now() + OTP_TTL_MS });
  return res.json({ success: true, verified: true });
}

function isOtpVerified(phone: string): boolean {
  const e = otpStore.get(normalizePhone(phone));
  return !!e && e.code === 'VERIFIED' && Date.now() < e.expiresAt;
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
  const entry = otpStore.get(p);
  if (!entry || (entry.code !== code && entry.code !== 'VERIFIED')) {
    return res.status(400).json({ error: 'OTP not verified' });
  }

  // Phone must be free
  const { data: existingPhone } = await supabase
    .from('users').select('id').eq('phone', p).maybeSingle();
  if (existingPhone) return res.status(409).json({ error: 'Phone already registered' });

  // Username must be free (case-insensitive)
  const { data: existingUsername } = await supabase
    .from('users').select('id').ilike('username', username).maybeSingle();
  if (existingUsername) return res.status(409).json({ error: 'Username already taken' });

  if (gender && !['male', 'female', 'other'].includes(gender)) {
    return res.status(400).json({ error: 'gender must be male, female, or other' });
  }

  // The legacy users.account_type column is kept for backward compat — store
  // the first selected type so existing code that reads it still works.
  const primaryAccountType = Array.isArray(account_types) && account_types.length > 0
    ? account_types[0]
    : 'fan';

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
      is_premium: false,
      coin_balance: 0,
    })
    .select('id, phone, name, username, email, gender, dob, link, bio, city_id, account_type, profile_picture_url, is_premium, coin_balance, created_at')
    .single();
  if (error || !user) {
    return res.status(500).json({ error: error?.message || 'Failed to create user' });
  }

  // Best-effort multi-row inserts.
  if (Array.isArray(account_types) && account_types.length > 0) {
    const rows = account_types.map((t: string) => ({ user_id: user.id, account_type: t }));
    await supabase.from('user_account_types').insert(rows);
  }
  if (Array.isArray(sport_ids) && sport_ids.length > 0) {
    const rows = sport_ids.map((sid: string) => ({ user_id: user.id, sport_id: sid }));
    await supabase.from('user_sports').insert(rows);
  }

  // Apply coupon if present and valid.
  if (coupon_code) {
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
        updates.premium_expires_at = new Date(
          Date.now() + coupon.premium_months * 30 * 24 * 60 * 60 * 1000,
        ).toISOString();
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from('users').update(updates).eq('id', user.id);
      }
      await supabase.from('coupon_usages').insert({ coupon_id: coupon.id, user_id: user.id });
      await supabase.from('coupon_codes').update({ uses_count: coupon.uses_count + 1 }).eq('id', coupon.id);
    }
  }

  otpStore.delete(p);
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
  return res.json({ user, accessToken, refreshToken, isNewUser: true });
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
  const entry = otpStore.get(p);
  if (!entry) return res.status(400).json({ error: 'No OTP requested' });
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(p);
    return res.status(400).json({ error: 'OTP expired' });
  }
  // Accept either the original code or the VERIFIED marker (verify-otp may
  // have already been called separately by the client).
  if (entry.code !== code && entry.code !== 'VERIFIED') {
    return res.status(400).json({ error: 'Invalid OTP' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, phone, name, username, email, gender, dob, link, bio, city_id, account_type, profile_picture_url, is_premium, premium_expires_at, coin_balance, created_at')
    .eq('phone', p)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!user) {
    // Phone is not registered — caller should switch to the register flow.
    return res.status(404).json({ error: 'Phone not registered', needsRegistration: true });
  }

  otpStore.delete(p);
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
  return res.json({ user, accessToken, refreshToken, isNewUser: false });
}

// POST /auth/login  { phone, password }
export async function login(req: Request, res: Response) {
  const { phone, password } = req.body || {};
  if (!phone || !password) return res.status(400).json({ error: 'phone and password are required' });
  const p = normalizePhone(phone);
  const { data: user } = await supabase
    .from('users')
    .select('id, phone, name, password_hash, city_id, account_type, is_premium, coin_balance')
    .eq('phone', p)
    .maybeSingle();
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const accessToken = generateAccessToken(user.id);
  const refreshToken = generateRefreshToken(user.id);
  await supabase.from('refresh_tokens').insert({ user_id: user.id, token: refreshToken });
  const { password_hash: _ph, ...safe } = user;
  return res.json({ user: safe, accessToken, refreshToken });
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
export async function validateCoupon(req: Request, res: Response) {
  const code = ((req.query.code as string) || '').trim();
  if (!code) return res.status(400).json({ error: 'code is required' });
  const { data: coupon } = await supabase
    .from('coupon_codes')
    .select('description, expires_at, active, max_uses, uses_count')
    .ilike('code', code)
    .maybeSingle();
  if (!coupon || !coupon.active) return res.json({ valid: false });
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return res.json({ valid: false });
  }
  if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses) {
    return res.json({ valid: false });
  }
  return res.json({ valid: true, description: coupon.description ?? undefined });
}

// POST /auth/google — placeholder
export async function googleAuth(_req: Request, res: Response) {
  return res.status(501).json({ error: 'Google Sign-In coming soon' });
}

// POST /auth/reset-password  { phone, code, newPassword }
export async function resetPassword(req: Request, res: Response) {
  const { phone, code, newPassword } = req.body || {};
  if (!phone || !code || !newPassword) {
    return res.status(400).json({ error: 'phone, code, newPassword are required' });
  }
  const p = normalizePhone(phone);
  const entry = otpStore.get(p);
  if (!entry || (entry.code !== code && entry.code !== 'VERIFIED')) {
    return res.status(400).json({ error: 'OTP not verified' });
  }
  const password_hash = await bcrypt.hash(newPassword, 10);
  const { error } = await supabase.from('users').update({ password_hash }).eq('phone', p);
  if (error) return res.status(500).json({ error: error.message });
  otpStore.delete(p);
  return res.json({ success: true });
}

// POST /auth/change-phone  { newPhone, code }  (requires auth — verifies OTP sent to NEW phone)
export async function changePhone(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { newPhone, code } = req.body || {};
  if (!newPhone || !code) return res.status(400).json({ error: 'newPhone and code are required' });
  const p = normalizePhone(newPhone);
  const entry = otpStore.get(p);
  if (!entry || (entry.code !== code && entry.code !== 'VERIFIED')) {
    return res.status(400).json({ error: 'OTP not verified' });
  }
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('phone', p)
    .maybeSingle();
  if (existing) return res.status(409).json({ error: 'Phone already in use' });
  const { error } = await supabase.from('users').update({ phone: p }).eq('id', userId);
  if (error) return res.status(500).json({ error: error.message });
  otpStore.delete(p);
  return res.json({ success: true });
}
